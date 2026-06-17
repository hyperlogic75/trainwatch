/** "2025-06-21" → "6월 21일" */
export function format(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${parseInt(m)}월 ${parseInt(d)}일`
}

/** "HH:mm" → "HHmm" */
export function toTimeParam(time: string): string {
  return time.replace(':', '')
}

/** "YYYY-MM-DD" → "YYYYMMDD" */
export function toDateParam(date: string): string {
  return date.replace(/-/g, '')
}

/** 현재 KST 시각이 방해 금지 시간대인지 확인 */
export function isDndTime(dndFrom: string, dndTo: string): boolean {
  const now = new Date()
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const cur = kst.getHours() * 100 + kst.getMinutes()

  const [fh, fm] = dndFrom.split(':').map(Number)
  const [th, tm] = dndTo.split(':').map(Number)
  const from = fh * 100 + fm
  const to   = th * 100 + tm

  // 자정 넘기는 범위 대응 (예: 22:00 ~ 07:00)
  if (from > to) return cur >= from || cur < to
  return cur >= from && cur < to
}
