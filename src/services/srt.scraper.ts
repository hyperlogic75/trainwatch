import { BrowserContext } from 'playwright'
import { getBrowser } from './korail.scraper'
import { ScrapeParams, AvailableSeat } from '../types'

const SRT_LOGIN_URL  = 'https://etk.srail.kr/cmc/01/selectLoginForm.do'
const SRT_SEARCH_URL = 'https://etk.srail.kr/hpg/hra/01/selectScheduleList.do'

// SRT는 로그인 없이 열차 조회 가능 (예매만 로그인 필요)
export async function scrapeSRT(params: ScrapeParams): Promise<AvailableSeat[]> {
  const b = await getBrowser()
  const ctx: BrowserContext = await b.newContext({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  })

  const page = await ctx.newPage()

  try {
    const searchUrl = buildSrtUrl(params)
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 15_000 })
    await page.waitForSelector('.tbl_wrap, .no_result', { timeout: 10_000 })

    const noResult = await page.$('.no_result')
    if (noResult) return []

    const seats = await page.evaluate((seatClass) => {
      const rows = document.querySelectorAll('table.tbl_list tbody tr')
      const result: AvailableSeat[] = []

      rows.forEach((row) => {
        const cells = row.querySelectorAll('td')
        if (cells.length < 6) return

        const trainNo  = cells[0]?.textContent?.trim() ?? ''
        const depTime  = cells[1]?.textContent?.trim() ?? ''
        const arrTime  = cells[2]?.textContent?.trim() ?? ''
        const duration = cells[3]?.textContent?.trim() ?? ''

        // 일반실 셀 (index 4), 특실 셀 (index 5)
        const generalCell = cells[4]
        const firstCell   = cells[5]

        const generalAvail = generalCell &&
          !generalCell.querySelector('a')?.classList.contains('disabled') &&
          generalCell.textContent?.includes('예약')

        const firstAvail = firstCell &&
          !firstCell.querySelector('a')?.classList.contains('disabled') &&
          firstCell.textContent?.includes('예약')

        const price = 0 // SRT는 별도 요금 API 필요

        if (seatClass === 'GENERAL' && generalAvail) {
          result.push({ trainNo, departureTime: depTime, arrivalTime: arrTime,
            duration, seatClass: 'GENERAL', availableCount: 1, price })
        } else if (seatClass === 'FIRST' && firstAvail) {
          result.push({ trainNo, departureTime: depTime, arrivalTime: arrTime,
            duration, seatClass: 'FIRST', availableCount: 1, price })
        } else if (seatClass === 'ANY') {
          if (generalAvail) result.push({ trainNo, departureTime: depTime, arrivalTime: arrTime,
            duration, seatClass: 'GENERAL', availableCount: 1, price })
          if (firstAvail) result.push({ trainNo, departureTime: depTime, arrivalTime: arrTime,
            duration, seatClass: 'FIRST', availableCount: 1, price })
        }
      })

      return result
    }, params.seatClass)

    return seats
  } finally {
    await page.close()
    await ctx.close()
  }
}

function buildSrtUrl(p: ScrapeParams): string {
  // SRT는 POST 폼 방식이므로 GET 파라미터로 흉내
  const base = new URL(SRT_SEARCH_URL)
  base.searchParams.set('dptRsStnCdNm',  p.depCode)
  base.searchParams.set('arvRsStnCdNm',  p.arrCode)
  base.searchParams.set('dptDt',         p.date)      // YYYYMMDD
  base.searchParams.set('dptTm',         p.timeFrom)  // HHmm
  base.searchParams.set('psgNum',        '1')
  base.searchParams.set('seatAttCd',     '015')       // 일반 좌석
  return base.toString()
}
