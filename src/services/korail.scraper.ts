import { chromium, Browser, BrowserContext } from 'playwright'
import { ScrapeParams, AvailableSeat } from '../types'

// ─── 코레일 승차권 예매 URL ───────────────────────────────────
const KORAIL_URL = 'https://www.letskorail.com/ebizprd/EbizPrdTicketpr21100W.do'

let browser: Browser | null = null

/**
 * 브라우저 인스턴스를 재사용해 오버헤드를 줄임
 * 서버 시작 시 한 번만 띄우고 폴러가 공유
 */
export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',    // Railway 컨테이너 메모리 제한 대응
        '--disable-gpu',
        '--single-process',           // 메모리 절약
      ],
    })
  }
  return browser
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
  }
}

// ─── KTX 빈자리 조회 ─────────────────────────────────────────
export async function scrapeKorail(params: ScrapeParams): Promise<AvailableSeat[]> {
  const b = await getBrowser()
  const ctx: BrowserContext = await b.newContext({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  })

  const page = await ctx.newPage()

  try {
    // 코레일 직접 조회 API 엔드포인트 (모바일 웹 경유)
    const searchUrl = buildKorailUrl(params)
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 15_000 })

    // 열차 목록 렌더링 대기
    await page.waitForSelector('.train_list, .nodata', { timeout: 10_000 })

    // 데이터 없음 처리
    const noData = await page.$('.nodata')
    if (noData) return []

    // 열차 행 파싱
    const seats = await page.evaluate((seatClass) => {
      const rows = document.querySelectorAll('.train_list .train_row')
      const result: AvailableSeat[] = []

      rows.forEach((row) => {
        const trainNo = row.querySelector('.train_num')?.textContent?.trim() ?? ''
        const depTime = row.querySelector('.dep_time')?.textContent?.trim() ?? ''
        const arrTime = row.querySelector('.arr_time')?.textContent?.trim() ?? ''
        const duration = row.querySelector('.duration')?.textContent?.trim() ?? ''

        // 일반실 / 특실 버튼 상태 확인
        const generalBtn = row.querySelector('.btn_general') as HTMLElement | null
        const firstBtn   = row.querySelector('.btn_first')  as HTMLElement | null

        const generalAvail = generalBtn && !generalBtn.classList.contains('disabled')
        const firstAvail   = firstBtn   && !firstBtn.classList.contains('disabled')

        const price = parseInt(
          row.querySelector('.price')?.textContent?.replace(/[^0-9]/g, '') ?? '0',
        )

        // seatClass 필터 적용
        if (seatClass === 'GENERAL' && generalAvail) {
          result.push({ trainNo, departureTime: depTime, arrivalTime: arrTime,
            duration, seatClass: 'GENERAL', availableCount: 1, price })
        } else if (seatClass === 'FIRST' && firstAvail) {
          result.push({ trainNo, departureTime: depTime, arrivalTime: arrTime,
            duration, seatClass: 'FIRST', availableCount: 1, price: price + 10000 })
        } else if (seatClass === 'ANY') {
          if (generalAvail) result.push({ trainNo, departureTime: depTime, arrivalTime: arrTime,
            duration, seatClass: 'GENERAL', availableCount: 1, price })
          if (firstAvail)   result.push({ trainNo, departureTime: depTime, arrivalTime: arrTime,
            duration, seatClass: 'FIRST', availableCount: 1, price: price + 10000 })
        }
      })

      return result
    }, params.seatClass ?? 'GENERAL')

    return seats
  } finally {
    await page.close()
    await ctx.close()
  }
}

function buildKorailUrl(p: ScrapeParams): string {
  const base = new URL(KORAIL_URL)
  base.searchParams.set('strGoStart',   p.depCode)
  base.searchParams.set('strGoEnd',     p.arrCode)
  base.searchParams.set('strGoDate',    p.date)       // YYYYMMDD
  base.searchParams.set('strGoHour',    p.timeFrom)   // HHmm
  base.searchParams.set('strSeatNum',   '1')
  base.searchParams.set('radJobId',     '1')
  return base.toString()
}
