import { SeatInfo, CoachSeatMap } from './SeatTypes';

export class SeatRelationshipAnalyzer {
  /**
   * Find contiguous adjacent seats in the same physical row within a coach.
   * (col difference must be exactly 1, so seats on opposite sides of an aisle never qualify.)
   */
  public static findAdjacentSeats(coach: CoachSeatMap, count: number, includeSelected: boolean = false): SeatInfo[][] {
    const availableSeats = coach.seats.filter(s => s.isAvailable || (includeSelected && s.isSelected));
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

    const getSeatNum = (name: string): number => {
      const m = name.match(/\d+/);
      return m ? parseInt(m[0], 10) : NaN;
    };

    // Rank groups so true consecutive numeric pairs (e.g. CHA-4 + CHA-5 for husband/wife) are prioritized first
    validGroups.sort((gA, gB) => {
      const numA1 = getSeatNum(gA[0].name);
      const numA2 = getSeatNum(gA[gA.length - 1].name);
      const isConsecutiveA = !isNaN(numA1) && !isNaN(numA2) && numA2 === numA1 + (gA.length - 1);

      const numB1 = getSeatNum(gB[0].name);
      const numB2 = getSeatNum(gB[gB.length - 1].name);
      const isConsecutiveB = !isNaN(numB1) && !isNaN(numB2) && numB2 === numB1 + (gB.length - 1);

      if (isConsecutiveA && !isConsecutiveB) return -1;
      if (!isConsecutiveA && isConsecutiveB) return 1;

      return gA[0].row - gB[0].row || gA[0].col - gB[0].col;
    });

    return validGroups;
  }

  /**
   * Find face-to-face groups (seats in consecutive rows with matching column positions).
   *   count === 2 → one seat facing another   (same col, rows r and r+1)
   *   count === 4 → a 2×2 block                (rows r,r+1 × adjacent cols c,c+1)
   * Other counts have no face-to-face arrangement.
   */
  public static findFaceToFacePairs(coach: CoachSeatMap, count: number = 2): SeatInfo[][] {
    const availableSeats = coach.seats.filter(s => s.isAvailable);
    const validGroups: SeatInfo[][] = [];

    const at = new Map<string, SeatInfo>();
    availableSeats.forEach(s => at.set(`${s.row}:${s.col}`, s));

    if (count === 2) {
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
          if (s2.row === s1.row + 1) {
            validGroups.push([s1, s2]);
          }
        }
      });
    } else if (count === 4) {
      availableSeats.forEach(s => {
        const right = at.get(`${s.row}:${s.col + 1}`);
        const below = at.get(`${s.row + 1}:${s.col}`);
        const belowRight = at.get(`${s.row + 1}:${s.col + 1}`);
        if (right && below && belowRight) {
          validGroups.push([s, right, below, belowRight]);
        }
      });
    }

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