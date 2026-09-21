export interface Station {
  id: string;
  name: string;
  code?: string;
}

export interface SeatClass {
  id: string;
  name: string;
  code: string;
}

export type SeatMode =
  | 'single'
  | 'adjacent'
  | 'face_to_face'
  | 'best_available';

export interface BookingSettings {
  fromStation: string;
  toStation: string;
  journeyDate: string;
  targetTrain: string;
  seatClass: string;
  seatCount: number;
  seatMode: SeatMode;
  actionDelay: number;
  allowFallback: boolean;
  bookingTime?: string;
}

export enum AutomationState {
  IDLE = 'IDLE',
  CONFIGURED = 'CONFIGURED',
  WAITING_FOR_BOOKING_TIME = 'WAITING_FOR_BOOKING_TIME',
  STARTING = 'STARTING',
  HOME_PAGE = 'HOME_PAGE',
  SELECTING_ROUTE = 'SELECTING_ROUTE',
  SELECTING_DATE = 'SELECTING_DATE',
  SEARCHING = 'SEARCHING',
  SEARCH_RESULTS = 'SEARCH_RESULTS',
  FINDING_TRAIN = 'FINDING_TRAIN',
  SELECTING_TRAIN = 'SELECTING_TRAIN',
  SELECTING_CLASS = 'SELECTING_CLASS',
  WAITING_FOR_SEAT_MAP = 'WAITING_FOR_SEAT_MAP',
  ANALYZING_SEATS = 'ANALYZING_SEATS',
  SELECTING_SEATS = 'SELECTING_SEATS',
  CONTINUE = 'CONTINUE',
  USER_VERIFICATION_REQUIRED = 'USER_VERIFICATION_REQUIRED',
  OTP_REQUIRED = 'OTP_REQUIRED',
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
  CAPTCHA_REQUIRED = 'CAPTCHA_REQUIRED',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export type LogType = 'info' | 'success' | 'warning' | 'error';

export interface LogItem {
  id: string;
  timestamp: string;
  message: string;
  type: LogType;
}

export interface SeatDetailRow {
  className: string;
  seats: string;
  fare: string;
}

export interface SeatInfo {
  id: string;
  name: string;
  coach: string;
  row: number;
  col: number;
  isAvailable: boolean;
  isSelected: boolean;
  xPos?: number;
  yPos?: number;
  elementRef?: HTMLElement;
}

