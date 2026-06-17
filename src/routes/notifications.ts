import { FastifyInstance } from 'fastify'
import { db } from '../db/client'

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate)

  // ─── GET /notifications ──────────────────────────────────
  app.get('/notifications', async (req) => {
    const { userId } = req.user as any
    const { page = '1', limit = '20' } = req.query as any

    const skip = (parseInt(page) - 1) * parseInt(limit)

    const [items, total] = await Promise.all([
      db.notification.findMany({
        where:   { userId },
        orderBy: { sentAt: 'desc' },
        skip,
        take:    parseInt(limit),
        include: {
          watch: {
            select: { depName: true, arrName: true, trainType: true, date: true },
          },
        },
      }),
      db.notification.count({ where: { userId } }),
    ])

    return {
      success: true,
      data: {
        items,
        total,
        page:     parseInt(page),
        lastPage: Math.ceil(total / parseInt(limit)),
      },
    }
  })

  // ─── POST /notifications/read-all ───────────────────────
  app.post('/notifications/read-all', async (req) => {
    const { userId } = req.user as any

    await db.notification.updateMany({
      where: { userId, readAt: null },
      data:  { readAt: new Date() },
    })

    return { success: true }
  })

  // ─── GET /notifications/unread-count ────────────────────
  app.get('/notifications/unread-count', async (req) => {
    const { userId } = req.user as any

    const count = await db.notification.count({
      where: { userId, readAt: null },
    })

    return { success: true, data: { count } }
  })
}
