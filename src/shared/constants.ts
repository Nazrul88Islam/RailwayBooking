import { Station, SeatClass, BookingSettings } from './types';

export const APP_VERSION = "2.0";

export const STATIONS: Station[] = [
  { id: 'dhaka', name: 'Dhaka', code: 'DA' },
  { id: 'sylhet', name: 'Sylhet', code: 'SYL' },
  { id: 'chattogram', name: 'Chattogram', code: 'CTG' },
  { id: 'coxsbazar', name: "Cox's Bazar", code: 'CXB' },
  { id: 'rajshahi', name: 'Rajshahi', code: 'RJ' },
  { id: 'khulna', name: 'Khulna', code: 'KLN' },
  { id: 'rangpur', name: 'Rangpur', code: 'RNG' },
  { id: 'bogura', name: 'Bogura', code: 'BOG' },
  { id: 'mymensingh', name: 'Mymensingh', code: 'MSH' },
  { id: 'cumilla', name: 'Cumilla', code: 'CML' },
  { id: 'dinajpur', name: 'Dinajpur', code: 'DNP' },
  { id: 'jessore', name: 'Jessore', code: 'JSR' },
  { id: 'tangail', name: 'Tangail', code: 'TNG' },
  { id: 'ishwardi', name: 'Ishwardi', code: 'ISD' },
  { id: 'pabna', name: 'Pabna', code: 'PBN' },
  { id: 'feni', name: 'Feni', code: 'FNI' },
  { id: 'noakhali', name: 'Noakhali', code: 'NKL' },
  { id: 'brahmanbaria', name: 'Brahmanbaria', code: 'BBA' },
  { id: 'kishoreganj', name: 'Kishoreganj', code: 'KSG' },
  { id: 'sirajganj', name: 'Sirajganj', code: 'SJG' }
];

export const SEAT_CLASSES: SeatClass[] = [
  { id: 'AC_B', name: 'AC_B', code: 'AC_B' },
  { id: 'AC_S', name: 'AC_S', code: 'AC_S' },
  { id: 'SNIGDHA', name: 'SNIGDHA', code: 'SNIGDHA' },
  { id: 'F_BERTH', name: 'F_BERTH', code: 'F_BERTH' },
  { id: 'F_SEAT', name: 'F_SEAT', code: 'F_SEAT' },
  { id: 'F_CHAIR', name: 'F_CHAIR', code: 'F_CHAIR' },
  { id: 'S_CHAIR', name: 'S_CHAIR', code: 'S_CHAIR' },
  { id: 'SHOVAN', name: 'SHOVAN', code: 'SHOVAN' },
  { id: 'SHULOV', name: 'SHULOV', code: 'SHULOV' },
  { id: 'AC_CHAIR', name: 'AC_CHAIR', code: 'AC_CHAIR' }
];

export const DEFAULT_SETTINGS: BookingSettings = {
  fromStation: 'Dhaka',
  toStation: 'Sylhet',
  journeyDate: new Date().toISOString().split('T')[0],
  targetTrain: 'PARABAT',
  seatClass: 'S_CHAIR',
  seatCount: 2,
  seatMode: 'adjacent',
  actionDelay: 500,
  allowFallback: true,
  bookingTime: ''
};

export const DELAY_PRESETS = [
  { label: 'Ultra (50)', value: 50 },
  { label: 'Fast (150)', value: 150 },
  { label: 'Normal (350)', value: 350 },
  { label: 'Safe (600)', value: 600 }
];

export const POPUP_DIMENSIONS = {
  width: 400,
  minHeight: 620,
  maxHeight: 700
};
