import { SeatInfo, CoachSeatMap, SeatSelectionResult } from './SeatTypes';
import { SeatRelationshipAnalyzer } from './SeatRelationshipAnalyzer';
import { SeatMode } from '../../shared/types';

export class SeatSelectionEngine {
  /**
   * Select best matching seats based on mode and fallback preferences
   */
  public static selectSeats(
    coaches: CoachSeatMap[],
    targetCount: number,
    mode: SeatMode,
    allowFallback: boolean
  ): SeatSelectionResult {
    if (!coaches || coaches.length === 0) {
      return {
        success: false,
        seats: [],
        modeUsed: mode,
        reason: 'No coaches or seat maps available'
      };
    }

    // Step 1: Attempt requested mode
    for (const coach of coaches) {
      const match = this.attemptModeInCoach(coach, targetCount, mode);
      if (match && match.length === targetCount) {
        return {
          success: true,
          seats: match,
          modeUsed: mode
        };
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

    // Step 2: Fallback Cascade
    // Fallback 1: Adjacent seats in same coach
    if (mode !== 'adjacent') {
      for (const coach of coaches) {
        const adjacent = SeatRelationshipAnalyzer.findAdjacentSeats(coach, targetCount);
        if (adjacent.length > 0) {
          return {
            success: true,
            seats: adjacent[0],
            modeUsed: 'adjacent',
            reason: 'Fallback to adjacent pair in same coach'
          };
        }
      }
    }

    // Fallback 2: Same physical row
    for (const coach of coaches) {
      const sameRow = SeatRelationshipAnalyzer.findSameRowSeats(coach, targetCount);
      if (sameRow.length > 0) {
        return {
          success: true,
          seats: sameRow[0],
          modeUsed: 'adjacent',
          reason: 'Fallback to same physical row'
        };
      }
    }

    // Fallback 3: Face-to-face (for count === 2)
    if (targetCount === 2 && mode !== 'face_to_face') {
      for (const coach of coaches) {
        const facePairs = SeatRelationshipAnalyzer.findFaceToFacePairs(coach, 2);
        if (facePairs.length > 0) {
          return {
            success: true,
            seats: facePairs[0],
            modeUsed: 'face_to_face',
            reason: 'Fallback to face-to-face seating'
          };
        }
      }
    }

    // Fallback 4: Best available seats across any coach
    const allAvailableSeats: SeatInfo[] = [];
    coaches.forEach(c => {
      allAvailableSeats.push(...c.seats.filter(s => s.isAvailable));
    });

    if (allAvailableSeats.length >= targetCount) {
      return {
        success: true,
        seats: allAvailableSeats.slice(0, targetCount),
        modeUsed: 'best_available',
        reason: `Fallback to ${targetCount} best available seats`
      };
    }

    return {
      success: false,
      seats: [],
      modeUsed: mode,
      reason: `Insufficient seats available (found ${allAvailableSeats.length}, needed ${targetCount})`
    };
  }

  private static attemptModeInCoach(
    coach: CoachSeatMap,
    count: number,
    mode: SeatMode
  ): SeatInfo[] | null {
    if (mode === 'single' || count === 1) {
      const available = coach.seats.find(s => s.isAvailable);
      return available ? [available] : null;
    }

    if (mode === 'adjacent') {
      const groups = SeatRelationshipAnalyzer.findAdjacentSeats(coach, count);
      return groups.length > 0 ? groups[0] : null;
    }

    if (mode === 'face_to_face') {
      const pairs = SeatRelationshipAnalyzer.findFaceToFacePairs(coach, count);
      return pairs.length > 0 ? pairs[0] : null;
    }

    if (mode === 'best_available') {
      const available = coach.seats.filter(s => s.isAvailable);
      return available.length >= count ? available.slice(0, count) : null;
    }

    return null;
  }
}
