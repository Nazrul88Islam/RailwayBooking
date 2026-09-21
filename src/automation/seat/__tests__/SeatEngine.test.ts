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
    expect(availableSeats.length).toBe(9);
  });

  it('should find adjacent seat pairs in same coach', () => {
    const grid = [['A1', 'A2', 'A3', 'A4'], ['B1', 'B2(B)', 'B3', 'B4']];
    const coachMap = SeatMapParser.createSyntheticCoach('KA', grid);
    const adjacentPairs = SeatRelationshipAnalyzer.findAdjacentSeats(coachMap, 2);
    expect(adjacentPairs.length).toBe(4);
    expect(adjacentPairs[0].map(s => s.name)).toEqual(['A1', 'A2']);
  });

  it('should find 4 adjacent seats when available', () => {
    const grid = [['A1', 'A2', 'A3', 'A4'], ['B1', 'B2(B)', 'B3', 'B4']];
    const coachMap = SeatMapParser.createSyntheticCoach('KA', grid);
    const adjacentFours = SeatRelationshipAnalyzer.findAdjacentSeats(coachMap, 4);
    expect(adjacentFours.length).toBe(1);
    expect(adjacentFours[0].map(s => s.name)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('should select face-to-face pairs in consecutive rows', () => {
    const grid = [['A1', 'A2', 'A3', 'A4'], ['B1', 'B2', 'B3', 'B4']];
    const coachMap = SeatMapParser.createSyntheticCoach('KA', grid);
    const facePairs = SeatRelationshipAnalyzer.findFaceToFacePairs(coachMap, 2);
    expect(facePairs.length).toBe(4);
    expect(facePairs[0].map(s => s.name)).toEqual(['A1', 'B1']);
  });

  it('should fallback gracefully when exact requested layout is booked', () => {
    const gridSameRow = [['A1', 'A2(B)', 'A3', 'A4'], ['B1', 'B2', 'B3(B)', 'B4']];
    const coachSameRow = SeatMapParser.createSyntheticCoach('KA', gridSameRow);
    const resultSameRow = SeatSelectionEngine.selectSeats([coachSameRow], 3, 'adjacent', true);
    expect(resultSameRow.success).toBe(true);
    expect(resultSameRow.modeUsed).toBe('adjacent');
    expect(resultSameRow.seats.map(s => s.name)).toEqual(['A1', 'A3', 'A4']);

    const gridScattered = [['A1', 'A2(B)', 'A3(B)', 'A4'], ['B1', 'B2(B)', 'B3(B)', 'B4(B)']];
    const coachScattered = SeatMapParser.createSyntheticCoach('KA', gridScattered);
    const resultBestAvailable = SeatSelectionEngine.selectSeats([coachScattered], 3, 'adjacent', true);
    expect(resultBestAvailable.success).toBe(true);
    expect(resultBestAvailable.modeUsed).toBe('best_available');
    expect(resultBestAvailable.seats.length).toBe(3);

    const resultNoFallback = SeatSelectionEngine.selectSeats([coachScattered], 3, 'adjacent', false);
    expect(resultNoFallback.success).toBe(false);
  });

  it('reads seat availability from the page (disabled / booked / in-progress / selected) without ever writing to it', () => {
    const createMockElement = (className: string, attrs: Record<string, string> = {}) => {
      const attributes: Record<string, string> = { class: className, ...attrs };
      const writes: string[] = [];
      return {
        getAttribute: (key: string) => (key in attributes ? attributes[key] : null),
        setAttribute: (key: string) => { writes.push(`setAttribute:${key}`); },
        removeAttribute: (key: string) => { writes.push(`removeAttribute:${key}`); },
        hasAttribute: (key: string) => key in attributes,
        classList: {
          add: () => { writes.push('classList.add'); },
          remove: () => { writes.push('classList.remove'); },
          contains: (cls: string) => className.split(' ').includes(cls)
        },
        writes
      } as any;
    };

    const available = createMockElement('seat-btn seat-available', { 'data-seat-name': 'CHA-1' });
    const bookedByClass = createMockElement('seat-btn seat-booked bg-orange', { 'data-seat-name': 'CHA-16' });
    const disabledByAttr = createMockElement('seat-btn', { 'data-seat-name': 'CHA-17', disabled: '' });
    const ariaDisabled = createMockElement('seat-btn', { 'data-seat-name': 'CHA-18', 'aria-disabled': 'true' });
    const inProgress = createMockElement('seat-btn seat-in-progress', { 'data-seat-name': 'CHA-19' });
    const selected = createMockElement('seat-btn seat-selected', { 'data-seat-name': 'CHA-20' });

    expect(SeatMapParser.canDOMSelect(available)).toBe(true);
    expect(SeatMapParser.canDOMSelect(bookedByClass)).toBe(false);
    expect(SeatMapParser.canDOMSelect(disabledByAttr)).toBe(false);
    expect(SeatMapParser.canDOMSelect(ariaDisabled)).toBe(false);
    expect(SeatMapParser.canDOMSelect(inProgress)).toBe(false);
    expect(SeatMapParser.canDOMSelect(selected)).toBe(false);

    // Checking a seat must be READ-ONLY. (The old applyDOMSelectionState wrote data-dom-selectable /
    // aria-disabled onto Railway's elements and then read its own marks back as "booked", so a seat
    // that had ever been selected stayed unavailable forever.)
    [available, bookedByClass, disabledByAttr, ariaDisabled, inProgress, selected].forEach(el => {
      expect(el.writes).toEqual([]);
    });

    // ...and asking twice gives the same answer (no self-reinforcing state)
    expect(SeatMapParser.canDOMSelect(available)).toBe(true);
    expect(SeatMapParser.canDOMSelect(bookedByClass)).toBe(false);
  });

  it('should correctly handle AC_S (3 seats per row) sleeper berth layout', () => {
    const acsGrid = [['KHA-1', 'KHA-2', 'KHA-3'], ['KHA-4', 'KHA-5', 'KHA-6(B)']];
    const acsCoach = SeatMapParser.createSyntheticCoach('KHA_AC_S', acsGrid);
    expect(acsCoach.rows).toBe(2);
    expect(acsCoach.cols).toBe(3);
    const adjacentThree = SeatRelationshipAnalyzer.findAdjacentSeats(acsCoach, 3);
    expect(adjacentThree.length).toBe(1);
    expect(adjacentThree[0].map(s => s.name)).toEqual(['KHA-1', 'KHA-2', 'KHA-3']);
    expect(SeatMapParser.detectSeatsPerRow('KHA_AC_S')).toBe(3);
  });

  it('should correctly handle AC_B (2 seats per row) berth layout', () => {
    const acbGrid = [['KHA-1', 'KHA-2'], ['KHA-3', 'KHA-4']];
    const acbCoach = SeatMapParser.createSyntheticCoach('KHA_AC_B', acbGrid);
    expect(acbCoach.rows).toBe(2);
    expect(acbCoach.cols).toBe(2);
    const adjacentTwo = SeatRelationshipAnalyzer.findAdjacentSeats(acbCoach, 2);
    expect(adjacentTwo.length).toBe(2);
    expect(adjacentTwo[0].map(s => s.name)).toEqual(['KHA-1', 'KHA-2']);
    expect(SeatMapParser.detectSeatsPerRow('KHA_AC_B')).toBe(2);
  });

  it('should prioritize true side-by-side adjacent pairs (CHA-4 + CHA-5) for husband & wife over cross-row seats', () => {
    const grid = [
      ['CHA-1', 'CHA-2', 'CHA-3'],
      ['CHA-4', 'CHA-5', 'CHA-6', 'CHA-7'],
      ['CHA-8', 'CHA-9', 'CHA-10', 'CHA-11']
    ];
    const coach = SeatMapParser.createSyntheticCoach('CHA', grid);
    const result = SeatSelectionEngine.selectSeats([coach], 2, 'adjacent', true);
    expect(result.success).toBe(true);
    expect(result.modeUsed).toBe('adjacent');
    expect(result.seats.map(s => s.name)).toEqual(['CHA-1', 'CHA-2']);
    coach.seats.find(s => s.name === 'CHA-1')!.isAvailable = false;
    coach.seats.find(s => s.name === 'CHA-2')!.isAvailable = false;
    coach.seats.find(s => s.name === 'CHA-3')!.isAvailable = false;
    const row2Result = SeatSelectionEngine.selectSeats([coach], 2, 'adjacent', true);
    expect(row2Result.success).toBe(true);
    expect(row2Result.modeUsed).toBe('adjacent');
    expect(row2Result.seats.map(s => s.name)).toEqual(['CHA-4', 'CHA-5']);
  });

  it('never re-picks an already-selected seat and always returns EXACTLY the requested number of seats', () => {
    // The automation now starts from an empty Seat Details cart, so a plan is always N brand-new seats.
    // (A plan with fewer seats than requested — e.g. only UMA-2 to "complete" a pre-selected UMA-1 —
    // is what let seats pile up across coaches: KA-6 + TA-7 + THA-3.)
    const grid = [['UMA-1', 'UMA-2', 'UMA-3'], ['UMA-4', 'UMA-5', 'UMA-6', 'UMA-7']];
    const coach = SeatMapParser.createSyntheticCoach('UMA', grid);

    const uma1 = coach.seats.find(s => s.name === 'UMA-1')!;
    uma1.isSelected = true;
    uma1.isAvailable = false;

    const result = SeatSelectionEngine.selectSeats([coach], 2, 'adjacent', true);
    expect(result.success).toBe(true);
    expect(result.seats.length).toBe(2);
    expect(result.seats.some(s => s.isSelected)).toBe(false);
    expect(result.seats.map(s => s.name)).toEqual(['UMA-2', 'UMA-3']);

    for (const count of [1, 2, 3, 4]) {
      const r = SeatSelectionEngine.selectSeats([coach], count, 'best_available', true);
      expect(r.seats.length).toBe(count);
    }
  });

  it('falls back to consecutive seat NUMBERS (THA-15 + THA-16) only when no side-by-side pair exists', () => {
    // 15 is the last seat of one row and 16 the first of the next: consecutive numbers, not side by side
    const grid = [['THA-14(B)', 'THA-15'], ['THA-16', 'THA-17(B)']];
    const coach = SeatMapParser.createSyntheticCoach('THA', grid);

    expect(SeatRelationshipAnalyzer.findAdjacentSeats(coach, 2).length).toBe(0);

    const strict = SeatSelectionEngine.selectSeats([coach], 2, 'adjacent', false);
    expect(strict.success).toBe(false);

    const fallback = SeatSelectionEngine.selectSeats([coach], 2, 'adjacent', true);
    expect(fallback.success).toBe(true);
    expect(fallback.seats.map(s => s.name)).toEqual(['THA-15', 'THA-16']);
    expect(fallback.reason).toContain('consecutive');

    // a true side-by-side pair always wins over consecutive numbers
    const both = SeatMapParser.createSyntheticCoach('THA', [['THA-14', 'THA-15'], ['THA-16', 'THA-17(B)']]);
    const best = SeatSelectionEngine.selectSeats([both], 2, 'adjacent', true);
    expect(best.seats.map(s => s.name)).toEqual(['THA-14', 'THA-15']);
    expect(best.reason).toBeUndefined();
  });

  it('does not invent consecutive numbers when seat numbers repeat (ambiguous numbering)', () => {
    const coach = SeatMapParser.createSyntheticCoach('KA', [['A1', 'A2(B)', 'A3', 'A4'], ['B1', 'B2', 'B3(B)', 'B4']]);
    expect(SeatRelationshipAnalyzer.findConsecutiveNumberSeats(coach, 3)).toEqual([]);
  });

  it('ranks coaches: side-by-side < consecutive numbers < face-to-face < same row < best available', () => {
    const rank = (modeUsed: any, reason?: string) =>
      SeatSelectionEngine.rankResult({ success: true, seats: [], modeUsed, reason });
    expect(rank('adjacent')).toBeLessThan(rank('adjacent', 'Fallback to consecutive seat numbers'));
    expect(rank('adjacent', 'Fallback to consecutive seat numbers')).toBeLessThan(rank('face_to_face'));
    expect(rank('face_to_face')).toBeLessThan(rank('adjacent', 'Fallback to same physical row'));
    expect(rank('adjacent', 'Fallback to same physical row')).toBeLessThan(rank('best_available'));
  });
});