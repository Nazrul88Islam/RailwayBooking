import { SeatMode } from '../../shared/types';

export interface SeatInfo {
  id: string;
  name: string;
  coach: string;
  row: number;
  col: number;
  isAvailable: boolean;
  isSelected: boolean;
  canDOMSelect?: boolean;
  xPos?: number;
  yPos?: number;
  rawElement?: any;
}

export interface CoachSeatMap {
  coachName: string;
  seats: SeatInfo[];
  rows: number;
  cols: number;
}

export interface SeatSelectionResult {
  success: boolean;
  seats: SeatInfo[];
  modeUsed: SeatMode;
  reason?: string;
}
