import { describe, it, expect } from 'vitest';
import { SeatMapParser } from '../SeatMapParser';
import { SeatRelationshipAnalyzer } from '../SeatRelationshipAnalyzer';
import { SeatSelectionEngine } from '../SeatSelectionEngine';

describe('Seat Map Engine & Spatial Algorithms', () => {
  it('should parse synthetic coach grid correctly', () => {
    const grid = [
      ['A1', 'A2', 'A3', 'A4'],
      ['B1', 'B2(B)', 'B3', 'B4'],
      ['C1(B)', 'C2(B)', 'C3', 'C4']
    ];

    const coachMap = SeatMapParser.createSyntheticCoach('KA', grid);
    expect(coachMap.seats.length).toBe(12);

    const availableSeats = coachMap.seats.filter(s => s.isAvailable);
    expect(availableSeats.length).toBe(9); // 12 total - 3 booked
  });

  it('should find adjacent seat pairs in same coach', () => {
    const grid = [
      ['A1', 'A2', 'A3', 'A4'],
      ['B1', 'B2(B)', 'B3', 'B4']
    ];

    const coachMap = SeatMapParser.createSyntheticCoach('KA', grid);
    const adjacentPairs = SeatRelationshipAnalyzer.findAdjacentSeats(coachMap, 2);

    // In Row 1 (A): [A1, A2], [A2, A3], [A3, A4] -> 3 pairs
    // In Row 2 (B): B2 is booked, so B3-B4 -> 1 pair [B3, B4]
    expect(adjacentPairs.length).toBe(4);
    expect(adjacentPairs[0].map(s => s.name)).toEqual(['A1', 'A2']);
  });

  it('should find 4 adjacent seats when available', () => {
    const grid = [
      ['A1', 'A2', 'A3', 'A4'],
      ['B1', 'B2(B)', 'B3', 'B4']
    ];

    const coachMap = SeatMapParser.createSyntheticCoach('KA', grid);
    const adjacentFours = SeatRelationshipAnalyzer.findAdjacentSeats(coachMap, 4);

    expect(adjacentFours.length).toBe(1);
    expect(adjacentFours[0].map(s => s.name)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('should select face-to-face pairs in consecutive rows', () => {
    const grid = [
      ['A1', 'A2', 'A3', 'A4'],
      ['B1', 'B2', 'B3', 'B4']
    ];

    const coachMap = SeatMapParser.createSyntheticCoach('KA', grid);
    const facePairs = SeatRelationshipAnalyzer.findFaceToFacePairs(coachMap, 2);

    expect(facePairs.length).toBe(4); // A1+B1, A2+B2, A3+B3, A4+B4
    expect(facePairs[0].map(s => s.name)).toEqual(['A1', 'B1']);
  });

  it('should fallback gracefully when exact requested layout is booked', () => {
    // Row 1 has A1, A3, A4 (3 seats in same physical row, though A2 is booked)
    const gridSameRow = [
      ['A1', 'A2(B)', 'A3', 'A4'],
      ['B1', 'B2', 'B3(B)', 'B4']
    ];
    const coachSameRow = SeatMapParser.createSyntheticCoach('KA', gridSameRow);

    // Request 3 adjacent seats WITH fallback -> matches Same Physical Row
    const resultSameRow = SeatSelectionEngine.selectSeats([coachSameRow], 3, 'adjacent', true);
    expect(resultSameRow.success).toBe(true);
    expect(resultSameRow.modeUsed).toBe('adjacent');
    expect(resultSameRow.seats.map(s => s.name)).toEqual(['A1', 'A3', 'A4']);

    // Grid with seats scattered across rows so no single row has 3 seats
    const gridScattered = [
      ['A1', 'A2(B)', 'A3(B)', 'A4'],
      ['B1', 'B2(B)', 'B3(B)', 'B4(B)']
    ];
    const coachScattered = SeatMapParser.createSyntheticCoach('KA', gridScattered);

    // Request 3 adjacent seats -> falls all the way to best_available
    const resultBestAvailable = SeatSelectionEngine.selectSeats([coachScattered], 3, 'adjacent', true);
    expect(resultBestAvailable.success).toBe(true);
    expect(resultBestAvailable.modeUsed).toBe('best_available');
    expect(resultBestAvailable.seats.length).toBe(3);

    // Request 3 adjacent seats WITHOUT fallback -> fails
    const resultNoFallback = SeatSelectionEngine.selectSeats([coachScattered], 3, 'adjacent', false);
    expect(resultNoFallback.success).toBe(false);
  });

  it('should disable DOM selection for unavailable/booked elements and allow available seats', () => {
    const createMockElement = (className: string, attrs: Record<string, string> = {}) => {
      const classListSet = new Set(className.split(' ').filter(Boolean));
      const attributes: Record<string, string> = { class: className, ...attrs };
      return {
        getAttribute: (key: string) => attributes[key] || null,
        setAttribute: (key: string, val: string) => { attributes[key] = val; },
        removeAttribute: (key: string) => { delete attributes[key]; },
        hasAttribute: (key: string) => key in attributes,
        classList: {
          add: (cls: string) => classListSet.add(cls),
          remove: (cls: string) => classListSet.delete(cls),
          contains: (cls: string) => classListSet.has(cls)
        }
      } as any;
    };

    const availableBtn = createMockElement('seat-btn seat-available', { 'data-seat-name': 'CHA-1' });
    const bookedBtn = createMockElement('seat-btn seat-booked bg-orange', { 'data-seat-name': 'CHA-16' });

    // Test canDOMSelect before applying state
    expect(SeatMapParser.canDOMSelect(availableBtn)).toBe(true);
    expect(SeatMapParser.canDOMSelect(bookedBtn)).toBe(false);

    // Apply state
    SeatMapParser.applyDOMSelectionState(availableBtn, true);
    SeatMapParser.applyDOMSelectionState(bookedBtn, false);

    expect(availableBtn.getAttribute('data-dom-selectable')).toBe('true');
    expect(bookedBtn.getAttribute('data-dom-selectable')).toBe('false');
    expect(bookedBtn.getAttribute('aria-disabled')).toBe('true');
    expect(bookedBtn.classList.contains('dom-selection-disabled')).toBe(true);

    // Re-check canDOMSelect after applyDOMSelectionState
    expect(SeatMapParser.canDOMSelect(availableBtn)).toBe(true);
    expect(SeatMapParser.canDOMSelect(bookedBtn)).toBe(false);
  });

  it('should correctly handle AC_S (3 seats per row) sleeper berth layout', () => {
    // AC_S berth coach layout with 3 seats per row (e.g. KHA-1, KHA-2, KHA-3)
    const acsGrid = [
      ['KHA-1', 'KHA-2', 'KHA-3'],
      ['KHA-4', 'KHA-5', 'KHA-6(B)']
    ];

    const acsCoach = SeatMapParser.createSyntheticCoach('KHA_AC_S', acsGrid);
    expect(acsCoach.rows).toBe(2);
    expect(acsCoach.cols).toBe(3);

    // Should find 3 adjacent seats in Row 1 (KHA-1, KHA-2, KHA-3)
    const adjacentThree = SeatRelationshipAnalyzer.findAdjacentSeats(acsCoach, 3);
    expect(adjacentThree.length).toBe(1);
    expect(adjacentThree[0].map(s => s.name)).toEqual(['KHA-1', 'KHA-2', 'KHA-3']);

    // Detect seats per row helper test for AC_S
    expect(SeatMapParser.detectSeatsPerRow('KHA_AC_S')).toBe(3);
  });

  it('should correctly handle AC_B (2 seats per row) berth layout', () => {
    // AC_B berth coach layout with 2 seats per row (e.g. KHA-1, KHA-2 in cabin row)
    const acbGrid = [
      ['KHA-1', 'KHA-2'],
      ['KHA-3', 'KHA-4']
    ];

    const acbCoach = SeatMapParser.createSyntheticCoach('KHA_AC_B', acbGrid);
    expect(acbCoach.rows).toBe(2);
    expect(acbCoach.cols).toBe(2);

    // Should find 2 adjacent seats in Row 1 (KHA-1, KHA-2)
    const adjacentTwo = SeatRelationshipAnalyzer.findAdjacentSeats(acbCoach, 2);
    expect(adjacentTwo.length).toBe(2);
    expect(adjacentTwo[0].map(s => s.name)).toEqual(['KHA-1', 'KHA-2']);

    // Detect seats per row helper test for AC_B
    expect(SeatMapParser.detectSeatsPerRow('KHA_AC_B')).toBe(2);
  });
});




