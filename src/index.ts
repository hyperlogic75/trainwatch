import 'dotenv/config'
import { buildApp }     from './app'
import { db }           from './db/client'
import { initFirebase } from './services/push'
import { startPoller }  from './jobs/poller'
import { getBrowser, closeBrowser } from './services/korail.scraper'

const PORT = parseInt(process.env.PORT ?? '3000')
const HOST = process.env.HOST ?? '0.0.0.0'

async function main() {
  // 1. Firebase Admin 초기화
  initFirebase()
  console.log('[Boot] Firebase 초기화 완료')

  // 2. DB 연결 확인
  await db.$connect()
  console.log('[Boot] DB 연결 완료')

  // 3. Playwright 브라우저 워밍업 (첫 요청 지연 방지)
  await getBrowser()
  console.log('[Boot] Playwright 브라우저 시작')

  // 4. Fastify 앱 빌드 & 시작
  const app = await buildApp()
  await app.listen({ port: PORT, host: HOST })
  console.log(`[Boot] 서버 시작 — http://${HOST}:${PORT}`)

  // 5. 폴러 시작 (30초 간격 cron)
  startPoller()
  console.log('[Boot] 폴러 시작')

  // ─── 그레이스풀 셧다운 ──────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`[Shutdown] ${signal} 수신 — 종료 중...`)
    try {
      await app.close()
      await closeBrowser()
      await db.$disconnect()
      console.log('[Shutdown] 완료')
      process.exit(0)
    } catch (err) {
      console.error('[Shutdown] 오류:', err)
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('[Boot] 시작 실패:', err)
  process.exit(1)
})
