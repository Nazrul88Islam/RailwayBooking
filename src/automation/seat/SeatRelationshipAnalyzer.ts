import { SeatInfo, CoachSeatMap } from './SeatTypes';

const seatNumber = (name: string): number => {
  const m = name.match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
};

export class SeatRelationshipAnalyzer {
  /**
   * Find seats sitting SIDE BY SIDE in the same physical row within a coach.
   * (col difference must be exactly 1, so seats on opposite sides of an aisle never qualify.)
   * Groups whose seat numbers are consecutive (e.g. 12 + 13) are listed first.
   */
  public static findAdjacentSeats(coach: CoachSeatMap, count: number): SeatInfo[][] {
    const availableSeats = coach.seats.filter(s => s.isAvailable);
    const validGroups: SeatInfo[][] = [];

    const rowMap = new Map<number, SeatInfo[]>();
    availableSeats.forEach(s => {
      if (!rowMap.has(s.row)) rowMap.set(s.row, []);
      rowMap.get(s.row)!.push(s);
    });

    rowMap.forEach((rowSeats) => {
      rowSeats.sort((a, b) => a.col - b.col);

      for (let i = 0; i <= rowSeats.length - count; i++) {
        let isContiguous = true;
        const candidateGroup = [rowSeats[i]];

        for (let j = 1; j < count; j++) {
          if (rowSeats[i + j].col === candidateGroup[j - 1].col + 1) {
            candidateGroup.push(rowSeats[i + j]);
          } else {
            isContiguous = false;
            break;
          }
        }

        if (isContiguous) validGroups.push(candidateGroup);
      }
    });

    const isConsecutive = (g: SeatInfo[]) => {
      const first = seatNumber(g[0].name);
      const last = seatNumber(g[g.length - 1].name);
      return !isNaN(first) && !isNaN(last) && last === first + (g.length - 1);
    };

    validGroups.sort((gA, gB) => {
      const a = isConsecutive(gA);
      const b = isConsecutive(gB);
      if (a && !b) return -1;
      if (!a && b) return 1;
      return gA[0].row - gB[0].row || gA[0].col - gB[0].col;
    });

    return validGroups;
  }

  /**
   * Seats with consecutive NUMBERS (e.g. THA-15 + THA-16) even when they are not physically side
   * by side (15 is the end of one row, 16 the start of the next). Used only as a fallback.
   */
  public static findConsecutiveNumberSeats(coach: CoachSeatMap, count: number): SeatInfo[][] {
    // Check if seat numbers in the coach repeat (e.g. A1, B1 both produce number 1 -> column labels)
    const numCounts = new Map<number, number>();
    for (const s of coach.seats) {
      const n = seatNumber(s.name);
      if (!isNaN(n)) {
        numCounts.set(n, (numCounts.get(n) || 0) + 1);
      }
    }
    const hasDuplicateNumbers = Array.from(numCounts.values()).some(c => c > 1);
    if (hasDuplicateNumbers) return [];

    const numbered = coach.seats
      .filter(s => s.isAvailable && !isNaN(seatNumber(s.name)))
      .map(s => ({ s, n: seatNumber(s.name) }))
      .sort((a, b) => a.n - b.n);

    const groups: SeatInfo[][] = [];
    for (let i = 0; i + count <= numbered.length; i++) {
      let ok = true;
      for (let j = 1; j < count; j++) {
        if (numbered[i + j].n !== numbered[i + j - 1].n + 1) { ok = false; break; }
      }
      if (ok) groups.push(numbered.slice(i, i + count).map(x => x.s));
    }
    return groups;
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
          if (s2.row === s1.row + 1) validGroups.push([s1, s2]);
        }
      });
    } else if (count === 4) {
      availableSeats.forEach(s => {
        const right = at.get(`${s.row}:${s.col + 1}`);
        const below = at.get(`${s.row + 1}:${s.col}`);
        const belowRight = at.get(`${s.row + 1}:${s.col + 1}`);
        if (right && below && belowRight) validGroups.push([s, right, below, belowRight]);
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

  /**
   * True if a seat class is a berth / sleeper class (e.g. AC_B, AC_S, F_BERTH).
   */
  public static isBerthClass(seatClass: string): boolean {
    return /AC[-_ ]?[BS]|BERTH|SLEEPER|F[-_ ]?BERTH/i.test(seatClass || '');
  }

  /**
   * True if a seat is inside a Single Cabin (Coupe).
   * - In AC_B (2 berths per row): berths {1,2}, {7,8}, {9,10}, {11,12}, {17,18} form Single Cabins.
   *   (Berths {3..6} and {13..16} form First and Second Double Cabins).
   * - In AC_S (3 berths per row): berths 13..21 form 1st, 2nd, 3rd Single Cabins (13..15, 16..18, 19..21).
   *   (Berths 1..12 and 22..33 form 1st, 2nd, 3rd, 4th Double Cabins).
   */
  public static isSingleCabinSeat(seatName: string, row?: number, seatClass?: string): boolean {
    const n = seatNumber(seatName);
    if (!isNaN(n)) {
      if (seatClass && /AC[-_ ]?S/i.test(seatClass)) {
        return n >= 13 && n <= 21;
      }
      // In AC_B: berths {3..6} (First Double Cabin) and {13..16} (Second Double Cabin) are Double Cabin berths.
      // All other berth pairs (1,2; 7,8; 9,10; 11,12; 17,18) are Single Cabins!
      const isAcBDoubleCabin = (n >= 3 && n <= 6) || (n >= 13 && n <= 16);
      return !isAcBDoubleCabin;
    }
    return row !== 2 && row !== 3 && row !== 7 && row !== 8;
  }

  /**
   * True if all seats in the group belong to a Single Cabin (Coupe).
   */
  public static isSingleCabinGroup(group: SeatInfo[], seatClass?: string): boolean {
    if (!group || group.length === 0) return false;
    return group.every(s => SeatRelationshipAnalyzer.isSingleCabinSeat(s.name, s.row, seatClass));
  }

  /**
   * Find adjacent seats specifically in a Single Cabin (Coupe).
   */
  public static findSingleCabinAdjacentSeats(coach: CoachSeatMap, count: number = 2, seatClass?: string): SeatInfo[][] {
    const adjacent = this.findAdjacentSeats(coach, count);
    return adjacent.filter(group => this.isSingleCabinGroup(group, seatClass));
  }

  /**
   * Find adjacent seats specifically in a Double Cabin (4-berth or 6-berth cabin).
   */
  public static findDoubleCabinAdjacentSeats(coach: CoachSeatMap, count: number = 2, seatClass?: string): SeatInfo[][] {
    const adjacent = this.findAdjacentSeats(coach, count);
    return adjacent.filter(group => !this.isSingleCabinGroup(group, seatClass));
  }
}