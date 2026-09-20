import { SeatInfo, CoachSeatMap } from './SeatTypes';

export class SeatRelationshipAnalyzer {
  /**
   * Find contiguous adjacent seats in the same physical row within a coach.
   */
  public static findAdjacentSeats(coach: CoachSeatMap, count: number): SeatInfo[][] {
    const availableSeats = coach.seats.filter(s => s.isAvailable);
    const validGroups: SeatInfo[][] = [];

    // Group available seats by row
    const rowMap = new Map<number, SeatInfo[]>();
    availableSeats.forEach(s => {
      if (!rowMap.has(s.row)) rowMap.set(s.row, []);
      rowMap.get(s.row)!.push(s);
    });

    rowMap.forEach((rowSeats) => {
      // Sort row seats by column
      rowSeats.sort((a, b) => a.col - b.col);

      // Slide a window of size `count` over column contiguous seats
      for (let i = 0; i <= rowSeats.length - count; i++) {
        let isContiguous = true;
        const candidateGroup = [rowSeats[i]];

        for (let j = 1; j < count; j++) {
          // Check if column difference is exactly 1 (adjacent)
          if (rowSeats[i + j].col === candidateGroup[j - 1].col + 1) {
            candidateGroup.push(rowSeats[i + j]);
          } else {
            isContiguous = false;
            break;
          }
        }

        if (isContiguous) {
          validGroups.push(candidateGroup);
        }
      }
    });

    return validGroups;
  }

  /**
   * Find face-to-face pairs (seats in consecutive rows with matching column positions)
   */
  public static findFaceToFacePairs(coach: CoachSeatMap, count: number): SeatInfo[][] {
    const availableSeats = coach.seats.filter(s => s.isAvailable);
    const validGroups: SeatInfo[][] = [];

    // Group by col
    const colMap = new Map<number, SeatInfo[]>();
    availableSeats.forEach(s => {
      if (!colMap.has(s.col)) colMap.set(s.col, []);
      colMap.get(s.col)!.push(s);
    });

    colMap.forEach((colSeats) => {
      colSeats.sort((a, b) => a.row - b.row);

      for (let i = 0; i < colSeats.length - 1; i++) {
        const s1 = colSeats[i];
        const s2 = colSeats[i + 1];

        // Face-to-face pairs are in adjacent rows (row diff === 1) in same column
        if (s2.row === s1.row + 1) {
          validGroups.push([s1, s2]);
        }
      }
    });

    return validGroups;
  }

  /**
   * Find seats in the same physical row (even if separated by an aisle)
   */
  public static findSameRowSeats(coach: CoachSeatMap, count: number): SeatInfo[][] {
    const availableSeats = coach.seats.filter(s => s.isAvailable);
    const validGroups: SeatInfo[][] = [];

    const rowMap = new Map<number, SeatInfo[]>();
    availableSeats.forEach(s => {
      if (!rowMap.has(s.row)) rowMap.set(s.row, []);
      rowMap.get(s.row)!.push(s);
    });

    rowMap.forEach((rowSeats) => {
      if (rowSeats.length >= count) {
        rowSeats.sort((a, b) => a.col - b.col);
        validGroups.push(rowSeats.slice(0, count));
      }
    });

    return validGroups;
  }
}
