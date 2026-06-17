import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { scrapeKorail } from '../services/korail.scraper'
import { scrapeSRT } from '../services/srt.scraper'
import { FREE_PLAN_LIMIT } from '../utils/constants'

const CreateWatchSchema = z.object({
  trainType:  z.enum(['KTX', 'SRT']),
  depCode:    z.string(),
  depName:    z.string(),
  arrCode:    z.string(),
  arrName:    z.string(),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeFrom:   z.string().regex(/^\d{2}:\d{2}$/),
  timeTo:     z.string().regex(/^\d{2}:\d{2}$/),
  seatClass:  z.enum(['GENERAL', 'FIRST', 'ANY']),
})

export async function watchRoutes(app: FastifyInstance): Promise<void> {

  // 모든 라우트 인증 필요
  app.addHook('onRequest', app.authenticate)

  // ─── GET /watches ────────────────────────────────────────
  app.get('/watches', async (req) => {
    const { userId } = req.user as any

    const watches = await db.watch.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
    })

    return { success: true, data: watches }
  })

  // ─── POST /watches ───────────────────────────────────────
  app.post('/watches', async (req, reply) => {
    const { userId, plan } = req.user as any

    const body = CreateWatchSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() })
    }

    // 플랜 한도 체크
    if (plan === 'FREE') {
      const count = await db.watch.count({
        where: { userId, status: { not: 'EXPIRED' } },
      })
      if (count >= FREE_PLAN_LIMIT) {
        return reply.status(403).send({
          error: `무료 플랜은 최대 ${FREE_PLAN_LIMIT}개까지 등록 가능합니다.`,
          code:  'PLAN_LIMIT_EXCEEDED',
        })
      }
    }

    const { date, ...rest } = body.data

    // 만료 시각: 해당 날짜 23:59:59 KST
    const expiresAt = new Date(`${date}T23:59:59+09:00`)

    const watch = await db.watch.create({
      data: {
        userId,
        ...rest,
        date,
        expiresAt,
      },
    })

    return { success: true, data: watch }
  })

  // ─── DELETE /watches/:id ─────────────────────────────────
  app.delete('/watches/:id', async (req, reply) => {
    const { userId } = req.user as any
    const { id } = req.params as { id: string }

    const watch = await db.watch.findFirst({ where: { id, userId } })
    if (!watch) return reply.status(404).send({ error: '조건을 찾을 수 없습니다.' })

    await db.watch.delete({ where: { id } })
    return { success: true }
  })

  // ─── POST /watches/:id/pause ─────────────────────────────
  app.post('/watches/:id/pause', async (req, reply) => {
    const { userId } = req.user as any
    const { id } = req.params as { id: string }

    const watch = await db.watch.findFirst({ where: { id, userId } })
    if (!watch) return reply.status(404).send({ error: '조건을 찾을 수 없습니다.' })

    const updated = await db.watch.update({
      where: { id },
      data:  { status: 'PAUSED' },
    })
    return { success: true, data: updated }
  })

  // ─── POST /watches/:id/resume ────────────────────────────
  app.post('/watches/:id/resume', async (req, reply) => {
    const { userId } = req.user as any
    const { id } = req.params as { id: string }

    const watch = await db.watch.findFirst({ where: { id, userId } })
    if (!watch) return reply.status(404).send({ error: '조건을 찾을 수 없습니다.' })

    // 만료된 조건은 재개 불가
    if (new Date(watch.expiresAt) < new Date()) {
      return reply.status(400).send({ error: '만료된 조건은 재개할 수 없습니다.' })
    }

    const updated = await db.watch.update({
      where: { id },
      data:  { status: 'ACTIVE' },
    })
    return { success: true, data: updated }
  })

  // ─── POST /watches/:id/check ─────────────────────────────
  // 사용자가 수동으로 즉시 체크 요청
  app.post('/watches/:id/check', async (req, reply) => {
    const { userId } = req.user as any
    const { id } = req.params as { id: string }

    const watch = await db.watch.findFirst({ where: { id, userId } })
    if (!watch) return reply.status(404).send({ error: '조건을 찾을 수 없습니다.' })

    const params = {
      trainType: watch.trainType as 'KTX' | 'SRT',
      depCode:   watch.depCode,
      arrCode:   watch.arrCode,
      date:      watch.date.replace(/-/g, ''),
      timeFrom:  watch.timeFrom.replace(':', ''),
      seatClass: watch.seatClass as 'GENERAL' | 'FIRST' | 'ANY',
    }

    const startAt = Date.now()
    const seats = watch.trainType === 'KTX'
      ? await scrapeKorail(params)
      : await scrapeSRT(params)

    return {
      success: true,
      data: {
        watchId:      id,
        hasAvailable: seats.length > 0,
        seats,
        checkedAt:    new Date().toISOString(),
        durationMs:   Date.now() - startAt,
      },
    }
  })
}
