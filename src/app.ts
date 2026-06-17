import Fastify   from 'fastify'
import cors      from '@fastify/cors'
import jwt       from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import fp        from 'fastify-plugin'

import { authMiddleware }     from './middleware/auth'
import { authRoutes }         from './routes/auth'
import { watchRoutes }        from './routes/watches'
import { notificationRoutes } from './routes/notifications'

export async function buildApp() {
  const app = Fastify({
    logger: {
      transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  })

  await app.register(cors, {
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? true,
  })

  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod',
  })

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  // authMiddleware를 먼저 등록해야 하위 플러그인에서 app.authenticate 사용 가능
  await app.register(authMiddleware)

  // 라우터를 fp()로 감싸서 데코레이터 스코프 공유
  await app.register(fp(authRoutes))
  await app.register(fp(watchRoutes))
  await app.register(fp(notificationRoutes))

  app.get('/health', async () => ({
    status: 'ok',
    ts:     new Date().toISOString(),
    env:    process.env.NODE_ENV,
  }))

  app.setErrorHandler((error, _req, reply) => {
    app.log.error(error)
    if (error.statusCode === 429) {
      return reply.status(429).send({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' })
    }
    reply.status(error.statusCode ?? 500).send({
      error: error.message ?? '서버 오류가 발생했습니다.',
    })
  })

  return app
}
