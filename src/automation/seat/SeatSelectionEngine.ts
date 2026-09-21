import { SeatInfo, CoachSeatMap, SeatSelectionResult } from './SeatTypes';
import { SeatRelationshipAnalyzer } from './SeatRelationshipAnalyzer';
import { SeatMode } from '../../shared/types';

export class SeatSelectionEngine {
  /**
   * Select best matching seats based on mode and fallback preferences.
   * A successful result ALWAYS contains exactly `targetCount` seats from ONE coach.
   */
  public static selectSeats(
    coaches: CoachSeatMap[],
    targetCount: number,
    mode: SeatMode,
    allowFallback: boolean
  ): SeatSelectionResult {
    if (!coaches || coaches.length === 0) {
      return { success: false, seats: [], modeUsed: mode, reason: 'No coaches or seat maps available' };
    }

    // Step 1: Attempt requested mode
    for (const coach of coaches) {
      const match = this.attemptModeInCoach(coach, targetCount, mode);
      if (match && match.length === targetCount) {
        return { success: true, seats: match, modeUsed: mode };
      }
    }

    // If exact mode match failed and fallback is disabled -> Fail
    if (!allowFallback) {
      return {
        success: false,
        seats: [],
        modeUsed: mode,
        reason: `Requested mode '${mode}' for ${targetCount} seats was not available and fallback is disabled.`
      };
    }

    // Step 2: Fallback cascade (best arrangement first)
    // Fallback 1: seats side by side
    if (mode !== 'adjacent') {
      for (const coach of coaches) {
        const adjacent = SeatRelationshipAnalyzer.findAdjacentSeats(coach, targetCount);
        if (adjacent.length > 0) {
          return { success: true, seats: adjacent[0], modeUsed: 'adjacent', reason: 'Fallback to adjacent seats in same coach' };
        }
      }
    }

    // Fallback 2: consecutive seat numbers (e.g. THA-15 + THA-16)
    if (targetCount > 1) {
      for (const coach of coaches) {
        const groups = SeatRelationshipAnalyzer.findConsecutiveNumberSeats(coach, targetCount);
        if (groups.length > 0) {
          return { success: true, seats: groups[0], modeUsed: 'adjacent', reason: 'Fallback to consecutive seat numbers' };
        }
      }
    }

    // Fallback 3: Face-to-face (2 or 4 seats)
    if ((targetCount === 2 || targetCount === 4) && mode !== 'face_to_face') {
      for (const coach of coaches) {
        const groups = SeatRelationshipAnalyzer.findFaceToFacePairs(coach, targetCount);
        if (groups.length > 0) {
          return { success: true, seats: groups[0], modeUsed: 'face_to_face', reason: 'Fallback to face-to-face seating' };
        }
      }
    }

    // Fallback 4: Same physical row (may straddle the aisle)
    for (const coach of coaches) {
      const sameRow = SeatRelationshipAnalyzer.findSameRowSeats(coach, targetCount);
      if (sameRow.length > 0) {
        return { success: true, seats: sameRow[0], modeUsed: 'adjacent', reason: 'Fallback to same physical row' };
      }
    }

    // Fallback 5: Best available seats — from ONE coach (seats in different coaches must never be mixed)
    for (const coach of coaches) {
      const available = coach.seats.filter(s => s.isAvailable);
      if (available.length >= targetCount) {
        return {
          success: true,
          seats: this.pickClosestTogether(available, targetCount),
          modeUsed: 'best_available',
          reason: `Fallback to ${targetCount} best available seats`
        };
      }
    }

    const total = coaches.reduce((n, c) => n + c.seats.filter(s => s.isAvailable).length, 0);
    return {
      success: false,
      seats: [],
      modeUsed: mode,
      reason: `Insufficient seats available in a single coach (found ${total}, needed ${targetCount})`
    };
  }

  /** Lower = better. Used to compare coaches when no coach satisfies the requested mode exactly. */
  public static rankResult(result: SeatSelectionResult): number {
    const reason = result.reason || '';
    if (result.modeUsed === 'adjacent') {
      if (reason.includes('same physical row')) return 3;   // may straddle the aisle
      if (reason.includes('consecutive')) return 1;         // e.g. 15 + 16
      return 0;                                             // truly side by side
    }
    if (result.modeUsed === 'face_to_face') return 2;
    return 4;
  }

  private static attemptModeInCoach(
    coach: CoachSeatMap,
    count: number,
    mode: SeatMode
  ): SeatInfo[] | null {
    const available = coach.seats.filter(s => s.isAvailable);

    if (count === 1) {
      return available.length > 0 ? [available[0]] : null;
    }

    // 'single' with several seats means "they do not have to sit together"
    if (mode === 'single' || mode === 'best_available') {
      if (available.length < count) return null;

      // Still prefer seats that are together when possible
      const adjacent = SeatRelationshipAnalyzer.findAdjacentSeats(coach, count);
      if (adjacent.length > 0) return adjacent[0];

      const sameRow = SeatRelationshipAnalyzer.findSameRowSeats(coach, count);
      if (sameRow.length > 0) return sameRow[0];

      return this.pickClosestTogether(available, count);
    }

    if (mode === 'adjacent') {
      const groups = SeatRelationshipAnalyzer.findAdjacentSeats(coach, count);
      return groups.length > 0 ? groups[0] : null;
    }

    if (mode === 'face_to_face') {
      const groups = SeatRelationshipAnalyzer.findFaceToFacePairs(coach, count);
      return groups.length > 0 ? groups[0] : null;
    }

    return null;
  }

  /** Take `count` seats that are as close together (row-major order) as possible. */
  private static pickClosestTogether(available: SeatInfo[], count: number): SeatInfo[] {
    const sorted = [...available].sort((a, b) => a.row - b.row || a.col - b.col);
    let best = sorted.slice(0, count);
    let bestSpan = Infinity;

    for (let i = 0; i + count <= sorted.length; i++) {
      const window = sorted.slice(i, i + count);
      const span =
        (window[window.length - 1].row - window[0].row) * 10 +
        (Math.max(...window.map(s => s.col)) - Math.min(...window.map(s => s.col)));
      if (span < bestSpan) {
        bestSpan = span;
        best = window;
      }
    }
    return best;
  }
}