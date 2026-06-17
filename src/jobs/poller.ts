import cron from 'node-cron'
import { db } from '../db/client'
import { scrapeKorail } from '../services/korail.scraper'
import { scrapeSRT } from '../services/srt.scraper'
import { sendSeatAvailableNotification, sendWatchExpiredNotification } from '../services/push'
import { AvailableSeat, PollResult } from '../types'
import { format } from '../utils/date.utils'

// ─── 동시 폴링 제어 ──────────────────────────────────────────
const CONCURRENCY = 3       // 동시 스크래핑 최대 3개 (브라우저 부하 제어)
const POLL_TIMEOUT = 20_000 // 20초 타임아웃

let isPolling = false       // 이전 폴링 완료 전 중복 실행 방지

// ─── 메인 폴러 ───────────────────────────────────────────────
export function startPoller(): cron.ScheduledTask {
  const task = cron.schedule('*/30 * * * * *', async () => {
    if (isPolling) {
      console.log('[Poller] 이전 폴링 진행 중 — 스킵')
      return
    }

    isPolling = true
    const startAt = Date.now()

    try {
      await runPollCycle()
      console.log(`[Poller] 사이클 완료 (${Date.now() - startAt}ms)`)
    } catch (err) {
      console.error('[Poller] 사이클 오류', err)
    } finally {
      isPolling = false
    }
  })

  console.log('[Poller] 시작 — 30초 간격')
  return task
}

// ─── 폴링 사이클 ─────────────────────────────────────────────
async function runPollCycle(): Promise<void> {
  const now = new Date()

  // 1. 만료된 조건 일괄 처리
  await expireWatches(now)

  // 2. ACTIVE 조건 목록 조회 (유저 FCM 토큰 포함)
  const watches = await db.watch.findMany({
    where: {
      status: 'ACTIVE',
      expiresAt: { gt: now },
    },
    include: {
      user: { select: { fcmToken: true, plan: true } },
    },
    orderBy: { lastCheckedAt: 'asc' }, // 오래된 것 먼저
    take: 50,                           // 최대 50개/사이클
  })

  if (watches.length === 0) return

  console.log(`[Poller] ${watches.length}개 조건 폴링 시작`)

  // 3. 동시성 제한으로 병렬 폴링
  await processInChunks(watches, CONCURRENCY, pollWatch)
}

// ─── 개별 감시 조건 폴링 ─────────────────────────────────────
async function pollWatch(watch: any): Promise<void> {
  const startAt = Date.now()
  let success = false
  let hasSeats = false
  let error: string | undefined

  try {
    const params = {
      trainType: watch.trainType,
      depCode:   watch.depCode,
      arrCode:   watch.arrCode,
      date:      watch.date.replace(/-/g, ''),  // YYYY-MM-DD → YYYYMMDD
      timeFrom:  watch.timeFrom.replace(':', ''), // HH:mm → HHmm
      seatClass: watch.seatClass,
    }

    // 4. 스크래핑 (타임아웃 보호)
    const seats = await withTimeout(
      watch.trainType === 'KTX'
        ? scrapeKorail(params)
        : scrapeSRT(params),
      POLL_TIMEOUT,
    )

    success = true
    hasSeats = seats.length > 0

    // 5. 빈자리 발견 → 푸시 + 알림 기록
    if (hasSeats && watch.user.fcmToken) {
      await handleSeatFound(watch, seats)
    }

    // 6. checkCount, lastCheckedAt 업데이트
    await db.watch.update({
      where: { id: watch.id },
      data: {
        checkCount:    { increment: 1 },
        lastCheckedAt: new Date(),
      },
    })
  } catch (err: any) {
    error = err.message
    console.error(`[Poller] Watch ${watch.id} 오류:`, err.message)
  }

  // 7. 폴링 로그 기록
  await db.pollLog.create({
    data: {
      watchId:    watch.id,
      success,
      hasSeats,
      durationMs: Date.now() - startAt,
      error,
    },
  }).catch(() => { /* 로그 실패는 폴링에 영향 없음 */ })
}

// ─── 빈자리 발견 처리 ────────────────────────────────────────
async function handleSeatFound(watch: any, seats: AvailableSeat[]): Promise<void> {
  const route = `${watch.depName} → ${watch.arrName}`
  const date  = formatDate(watch.date)

  // 중복 발송 방지: 최근 5분 내 동일 조건으로 이미 FOUND 알림 발송 시 스킵
  const recentNotif = await db.notification.findFirst({
    where: {
      watchId: watch.id,
      status:  'FOUND',
      sentAt:  { gt: new Date(Date.now() - 5 * 60 * 1000) },
    },
  })
  if (recentNotif) return

  // FCM 발송
  const result = await sendSeatAvailableNotification({
    fcmToken:    watch.user.fcmToken,
    watchId:     watch.id,
    route,
    date,
    seats,
    deepLinkUrl: `trainwatch://watch/${watch.id}`,
  })

  // 토큰 무효 → DB에서 제거
  if (!result.success && result.error === 'INVALID_TOKEN') {
    await db.user.update({
      where: { id: watch.userId },
      data:  { fcmToken: null },
    })
    return
  }

  // 알림 이력 저장
  await db.notification.create({
    data: {
      userId:    watch.userId,
      watchId:   watch.id,
      status:    'FOUND',
      seatsJson: seats,
      message:   `${route} ${date} ${seats[0].departureTime} 출발 빈자리 발생`,
    },
  })

  console.log(`[Poller] 📱 Push sent — Watch:${watch.id} Route:${route}`)
}

// ─── 만료 처리 ───────────────────────────────────────────────
async function expireWatches(now: Date): Promise<void> {
  const expired = await db.watch.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } },
    include: { user: { select: { fcmToken: true } } },
  })

  if (expired.length === 0) return

  await db.watch.updateMany({
    where: { id: { in: expired.map((w) => w.id) } },
    data:  { status: 'EXPIRED' },
  })

  // 만료 알림 발송
  await Promise.allSettled(
    expired
      .filter((w) => w.user.fcmToken)
      .map((w) =>
        sendWatchExpiredNotification(
          w.user.fcmToken!,
          `${w.depName} → ${w.arrName}`,
        ),
      ),
  )

  console.log(`[Poller] ${expired.length}개 조건 만료 처리`)
}

// ─── 유틸 ────────────────────────────────────────────────────
async function processInChunks<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size)
    await Promise.allSettled(chunk.map(fn))
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    ),
  ])
}

function formatDate(dateStr: string): string {
  // "2025-06-21" → "6월 21일"
  const [, m, d] = dateStr.split('-')
  return `${parseInt(m)}월 ${parseInt(d)}일`
}
