import { SeatInfo, CoachSeatMap } from './SeatTypes';

export class SeatMapParser {
  /**
   * Parse seat elements from container element (or simulated DOM array for unit tests)
   */
  public static parseFromDOM(container: HTMLElement | Document = document): CoachSeatMap[] {
    const coachMaps: Map<string, SeatInfo[]> = new Map();

    // 1. Detect current coach name from dropdown if available
    let defaultCoachName = 'COACH-1';
    if (typeof document !== 'undefined') {
      const selectElements = Array.from((container as HTMLElement | Document).querySelectorAll('select'));
      for (const sel of selectElements) {
        const selectedOpt = sel.selectedOptions ? sel.selectedOptions[0] : sel.options[sel.selectedIndex];
        if (selectedOpt) {
          const text = (selectedOpt.text || selectedOpt.value).toUpperCase();
          if (text.includes('SEAT') || text.includes('AVAILABLE') || text.includes('COACH')) {
            const clean = text.split('(')[0].split('-')[0].replace(/SEAT.*/i, '').trim();
            if (clean && !clean.includes('SELECT') && !clean.includes('CHOOSE')) {
              defaultCoachName = clean;
              break;
            }
          }
        }
      }
    }

    // 2. Query potential seat elements
    const candidateSelectors = [
      '.seat-layout *', '.seat-plan *', '#seat_map *', '[class*="seat-grid"] *',
      '[class*="seat-layout"] *', '[class*="seat-view"] *', '[class*="coach-layout"] *',
      '[class*="seat-matrix"] *', '[class*="seats-container"] *', '[class*="seat-details"] *',
      '.all-seats *', '.seat-available', '.seat-booked', '.seat-selected', '[data-seat-name]',
      '[data-seat]', 'button[class*="seat"]', 'div[class*="seat-item"]', '.coach-seat-btn',
      '.seat-details', '.single-seat'
    ];

    let rawElements = Array.from(container.querySelectorAll(candidateSelectors.join(', ')));

    if (rawElements.length === 0) {
      rawElements = Array.from(container.querySelectorAll('button, div, span, li, a, td'));
    }

    // 3. Filter for individual seat elements
    const seatElements = rawElements.filter(el => {
      // Must not contain many child elements
      if (el.children.length > 2) return false;

      const text = (el.textContent || '').trim();
      const dataSeat = el.getAttribute('data-seat-name') || el.getAttribute('data-seat') || el.getAttribute('data-seat-number');
      const seatCode = dataSeat || text;

      if (!seatCode) return false;

      // Seat code must be a short token like "KA-1", "KHA-12", "15", "A1", "S-1"
      const isShort = seatCode.length >= 1 && seatCode.length <= 12;
      const hasSeatPattern = /^([A-Z\u0980-\u09FF]{1,4}[-_\s]?)?\d{1,3}[A-Z]?(?:\(B\))?$/i.test(seatCode) ||
                             !!dataSeat ||
                             (isShort && /^[A-Z0-9]{1,6}$/i.test(seatCode));

      const containsForbiddenWords = /book|search|ticket|select|choose|train|details|vat|counter|online|fare|taka|৳/i.test(seatCode);

      return isShort && hasSeatPattern && !containsForbiddenWords;
    });

    seatElements.forEach((el, index) => {
      const dataSeat = el.getAttribute('data-seat-name') || el.getAttribute('data-seat') || el.getAttribute('data-seat-number');
      const textName = el.textContent?.trim() || '';
      const seatName = dataSeat || textName || `S-${index + 1}`;

      const coachName = el.getAttribute('data-coach') ||
                        el.closest('[data-coach-name]')?.getAttribute('data-coach-name') ||
                        defaultCoachName;

      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 0, left: 0 };
      const classNameStr = (el.className || '').toString().toLowerCase();

      const isBooked = classNameStr.includes('booked') ||
                       classNameStr.includes('disabled') ||
                       classNameStr.includes('occupied') ||
                       classNameStr.includes('sold') ||
                       classNameStr.includes('unavailable') ||
                       classNameStr.includes('taken') ||
                       el.hasAttribute('disabled');

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

