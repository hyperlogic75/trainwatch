import { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

// JWT authenticate 훅을 Fastify 인스턴스에 데코레이터로 추가
export const authMiddleware = fp(async (app: FastifyInstance) => {
  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      await req.jwtVerify()
    } catch {
      reply.status(401).send({ error: '인증이 필요합니다.' })
    }
  })
})

// TypeScript 타입 확장
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: any, reply: any) => Promise<void>
  }
}
