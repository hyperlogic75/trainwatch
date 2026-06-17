export type TrainType = 'KTX' | 'SRT'
export type SeatClass = 'GENERAL' | 'FIRST' | 'ANY'

export interface AvailableSeat {
  trainNo:       string
  departureTime: string   // HH:mm
  arrivalTime:   string   // HH:mm
  duration:      string   // e.g. "2시간 15분"
  seatClass:     SeatClass
  availableCount: number
  price:         number
}

export interface PollResult {
  watchId:      string
  hasAvailable: boolean
  seats:        AvailableSeat[]
  checkedAt:    string
  durationMs:   number
}

export interface ScrapeParams {
  trainType: TrainType
  depCode:   string
  arrCode:   string
  date:      string    // YYYYMMDD
  timeFrom:  string    // HHmm
}

// JWT payload
export interface JwtPayload {
  userId: string
  email:  string
  plan:   'FREE' | 'PRO'
}
