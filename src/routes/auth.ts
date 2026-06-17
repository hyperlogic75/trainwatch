import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { createHash } from 'crypto'
import { z } from 'zod'
import { db } from '../db/client'

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
})

const RegisterSchema = LoginSchema.extend({
  name: z.string().min(1).max(20),
})

const AppleSchema = z.object({
  identityToken: z.string(),
  nonce:         z.string(),         // 앱에서 생성한 원본 nonce
  name:          z.string().optional(),
})

const GoogleSchema = z.object({
  code:        z.string(),
  redirectUri: z.string(),
})

export async function authRoutes(app: FastifyInstance): Promise<void> {

  // ─── POST /auth/register ─────────────────────────────────
  app.post('/auth/register', async (req, reply) => {
    const body = RegisterSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() })
    }

    const { email, password, name } = body.data

    const exists = await db.user.findUnique({ where: { email } })
    if (exists) {
      return reply.status(409).send({ error: '이미 사용 중인 이메일입니다.' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await db.user.create({
      data: { email, passwordHash, name },
    })

    const token = app.jwt.sign(
      { userId: user.id, email: user.email, plan: user.plan },
      { expiresIn: '30d' },
    )

    return { success: true, data: { user: sanitizeUser(user), token } }
  })

  // ─── POST /auth/login ────────────────────────────────────
  app.post('/auth/login', async (req, reply) => {
    const body = LoginSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() })
    }

    const { email, password } = body.data

    const user = await db.user.findUnique({ where: { email } })
    if (!user) {
      return reply.status(401).send({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return reply.status(401).send({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' })
    }

    const token = app.jwt.sign(
      { userId: user.id, email: user.email, plan: user.plan },
      { expiresIn: '30d' },
    )

    return { success: true, data: { user: sanitizeUser(user), token } }
  })

  // ─── POST /auth/apple ────────────────────────────────────
  app.post('/auth/apple', async (req, reply) => {
    const body = AppleSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() })
    }

    const applePayload = decodeAppleToken(body.data.identityToken)
    if (!applePayload) {
      return reply.status(401).send({ error: 'Apple 토큰 검증 실패' })
    }

    // nonce 해시 일치 검증 (Replay Attack 방지)
    const expectedNonceHash = createHash('sha256')
      .update(body.data.nonce)
      .digest('hex')

    if (applePayload.nonce !== expectedNonceHash) {
      return reply.status(401).send({ error: 'nonce 불일치 — 보안 검증 실패' })
    }

    let user = await db.user.findUnique({ where: { appleId: applePayload.sub } })

    if (!user) {
      // 이미 동일 이메일로 가입된 계정이 있으면 Apple ID 연동
      const existingByEmail = applePayload.email
        ? await db.user.findUnique({ where: { email: applePayload.email } })
        : null

      if (existingByEmail) {
        user = await db.user.update({
          where: { id: existingByEmail.id },
          data:  { appleId: applePayload.sub },
        })
      } else {
        user = await db.user.create({
          data: {
            email:        applePayload.email ?? `${applePayload.sub}@privaterelay.appleid.com`,
            passwordHash: '',
            name:         body.data.name ?? '사용자',
            appleId:      applePayload.sub,
          },
        })
      }
    }

    const token = app.jwt.sign(
      { userId: user.id, email: user.email, plan: user.plan },
      { expiresIn: '30d' },
    )

    return { success: true, data: { user: sanitizeUser(user), token } }
  })

  // ─── POST /auth/google ───────────────────────────────────
  app.post('/auth/google', async (req, reply) => {
    const body = GoogleSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() })
    }

    const { code, redirectUri } = body.data
    const clientId     = process.env.GOOGLE_CLIENT_ID!
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!

    // 1. Authorization Code → Access Token 교환
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    })

    const tokenData = await tokenRes.json() as {
      access_token?: string
      error?: string
    }

    if (!tokenData.access_token) {
      return reply.status(401).send({ error: 'Google 토큰 발급 실패' })
    }

    // 2. Access Token → 사용자 정보 조회
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })

    const profile = await profileRes.json() as {
      id: string
      email: string
      name: string
      picture?: string
    }

    if (!profile.id) {
      return reply.status(401).send({ error: 'Google 프로필 조회 실패' })
    }

    // 3. DB — upsert
    let user = await db.user.findUnique({ where: { googleId: profile.id } })

    if (!user) {
      const existingByEmail = await db.user.findUnique({ where: { email: profile.email } })

      if (existingByEmail) {
        user = await db.user.update({
          where: { id: existingByEmail.id },
          data:  { googleId: profile.id },
        })
      } else {
        user = await db.user.create({
          data: {
            email:        profile.email,
            passwordHash: '',
            name:         profile.name,
            googleId:     profile.id,
          },
        })
      }
    }

    const jwtToken = app.jwt.sign(
      { userId: user.id, email: user.email, plan: user.plan },
      { expiresIn: '30d' },
    )

    return { success: true, data: { user: sanitizeUser(user), token: jwtToken } }
  })

  // ─── POST /auth/fcm-token ────────────────────────────────
  app.post('/auth/fcm-token', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { fcmToken } = req.body as { fcmToken: string }
    const { userId } = req.user as any

    await db.user.update({
      where: { id: userId },
      data:  { fcmToken },
    })

    return { success: true }
  })
}

function sanitizeUser(user: any) {
  const { passwordHash, ...safe } = user
  return safe
}

function decodeAppleToken(token: string): {
  sub: string
  email?: string
  nonce?: string
} | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString(),
    )
    return {
      sub:   payload.sub,
      email: payload.email,
      nonce: payload.nonce,
    }
  } catch {
    return null
  }
}
