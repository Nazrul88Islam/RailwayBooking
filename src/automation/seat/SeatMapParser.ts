import { SeatInfo, CoachSeatMap } from './SeatTypes';

export class SeatMapParser {
  /**
   * Parse seat elements from container element (or simulated DOM array for unit tests)
   */
  public static parseFromDOM(container: HTMLElement | Document): CoachSeatMap[] {
    const coachMaps: Map<string, SeatInfo[]> = new Map();

    // Comprehensive BD Railway selectors for coach layout & seat items
    const seatElements = Array.from(container.querySelectorAll(
      '.seat-layout .seat, [class*="seat-item"], .seat-available, .seat-booked, .coach-seat-btn, ' +
      '[data-seat-name], button[class*="Seat"], div[class*="seat-grid"] div, ' +
      '.seat-details, .single-seat, button[class*="seat"], div[class*="seat"]'
    )).filter(el => {
      // Filter out non-seat wrapper containers (keep individual seat buttons/divs)
      const text = el.textContent?.trim() || '';
      const isIndividualSeat = (text.length > 0 && text.length <= 8) || el.hasAttribute('data-seat-name');
      return isIndividualSeat;
    });

    seatElements.forEach((el, index) => {
      const seatName = el.textContent?.trim() || el.getAttribute('data-seat-name') || `S-${index + 1}`;
      const coachName = el.getAttribute('data-coach') || el.closest('[data-coach-name]')?.getAttribute('data-coach-name') || 'COACH-1';
      
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 0, left: 0 };
      
      const classNameStr = (el.className || '').toString().toLowerCase();
      const isBooked = classNameStr.includes('booked') || classNameStr.includes('disabled') || classNameStr.includes('occupied') || classNameStr.includes('sold') || el.hasAttribute('disabled');
      const isAvailable = !isBooked;

      const isSelected = classNameStr.includes('selected') || classNameStr.includes('active');

      const seat: SeatInfo = {
        id: `${coachName}_${seatName}`,
        name: seatName,
        coach: coachName,
        row: Math.floor(index / 4) + 1,
        col: (index % 4) + 1,
        isAvailable,
        isSelected,
        xPos: rect.left,
        yPos: rect.top,
        rawElement: el
      };

      if (!coachMaps.has(coachName)) {
        coachMaps.set(coachName, []);
      }
      coachMaps.get(coachName)!.push(seat);
    });

    const result: CoachSeatMap[] = [];
    coachMaps.forEach((seats, coachName) => {
      result.push({
        coachName,
        seats,
        rows: Math.max(...seats.map(s => s.row), 1),
        cols: Math.max(...seats.map(s => s.col), 1)
      });
    });

    return result;
  }

  /**
   * Helper to construct synthetic coach maps for unit testing algorithms
   */
  public static createSyntheticCoach(coachName: string, seatGrid: string[][]): CoachSeatMap {
    const seats: SeatInfo[] = [];

    seatGrid.forEach((rowSeats, rowIndex) => {
      rowSeats.forEach((seatCode, colIndex) => {
        if (!seatCode) return; // Empty aisle space
        const isBooked = seatCode.endsWith('(B)');
        const cleanName = seatCode.replace('(B)', '');

        seats.push({
          id: `${coachName}_${cleanName}`,
          name: cleanName,
          coach: coachName,
          row: rowIndex + 1,
          col: colIndex + 1,
          isAvailable: !isBooked,
          isSelected: false,
          xPos: colIndex * 50,
          yPos: rowIndex * 50
        });
      });
    });

    return {
      coachName,
      seats,
      rows: seatGrid.length,
      cols: Math.max(...seatGrid.map(r => r.length))
    };
  }
}
