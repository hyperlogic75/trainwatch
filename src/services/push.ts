import admin from 'firebase-admin'
import { AvailableSeat } from '../types'

// ─── Firebase Admin 초기화 (싱글톤) ──────────────────────────
let initialized = false

export function initFirebase(): void {
  if (initialized) return

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!serviceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 환경변수가 없습니다')
  }

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccount)),
  })

  initialized = true
}

// ─── 빈자리 발생 알림 발송 ───────────────────────────────────
export interface PushPayload {
  fcmToken:    string
  watchId:     string
  route:       string    // "서울 → 부산"
  date:        string    // "6월 21일"
  seats:       AvailableSeat[]
  deepLinkUrl: string    // trainwatch://watch/{watchId}
}

export async function sendSeatAvailableNotification(
  payload: PushPayload,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const seat = payload.seats[0]
  if (!seat) return { success: false, error: 'seats empty' }

  const title = `🚄 빈자리 발생! ${payload.route}`
  const body  = `${payload.date} ${seat.departureTime} 출발 · ${
    seat.seatClass === 'GENERAL' ? '일반실' : '특실'
  } · ${payload.seats.length}개 열차 확인됨`

  try {
    const messageId = await admin.messaging().send({
      token: payload.fcmToken,

      notification: { title, body },

      // iOS APNs 설정
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: 'default',
            badge: 1,
            'content-available': 1,
            'interruption-level': 'time-sensitive', // iOS 15+ 중요 알림
          },
        },
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
      },

      // Android FCM 설정
      android: {
        priority: 'high',
        notification: {
          channelId: 'train-watch',
          priority: 'max',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },

      // 딥링크 데이터 (앱에서 WatchDetail로 이동)
      data: {
        watchId:        payload.watchId,
        notificationId: Date.now().toString(),
        deepLink:       payload.deepLinkUrl,
        seatsJson:      JSON.stringify(payload.seats),
        type:           'SEAT_AVAILABLE',
      },
    })

    return { success: true, messageId }
  } catch (err: any) {
    // 토큰 만료/무효 처리
    if (
      err.code === 'messaging/registration-token-not-registered' ||
      err.code === 'messaging/invalid-registration-token'
    ) {
      return { success: false, error: 'INVALID_TOKEN' }
    }
    return { success: false, error: err.message }
  }
}

// ─── 감시 만료 알림 ──────────────────────────────────────────
export async function sendWatchExpiredNotification(
  fcmToken: string,
  route: string,
): Promise<void> {
  await admin.messaging().send({
    token: fcmToken,
    notification: {
      title: '감시 종료',
      body: `${route} 감시가 만료됐어요. 새 조건을 추가해 다시 시작할 수 있어요.`,
    },
    apns: {
      payload: { aps: { sound: 'default', badge: 0 } },
    },
  }).catch(() => { /* 만료 알림 실패는 무시 */ })
}
