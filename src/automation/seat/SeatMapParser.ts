import { SeatInfo, CoachSeatMap } from './SeatTypes';

/**
 * Seat status detection.
 *
 * The Railway legend has FOUR states: Available, Selected, In Progress, Booked.
 * Only "Available" seats may be picked. "In Progress" (held by someone else) and "Booked"
 * must never be treated as available. If the site uses class names that are not covered by
 * these patterns, add them here — this is the one place to tune.
 */
const BOOKED_RE = /booked|occupied|sold|taken|unavailable|disabled|blocked|orange|bg-orange|booked-seat|disabled-seat/;
const IN_PROGRESS_RE = /progress|pending|processing|on[-_ ]?hold|(^|[\s_-])hold(ing)?($|[\s_-])|reserved|locked|green|bg-green/;
const SELECTED_RE = /(^|[\s_-])selected($|[\s_-])/;
const ACTIVE_RE = /(^|[\s_-])(active|chosen|checked)($|[\s_-])/;
const AVAILABLE_RE = /(^|[\s_-])available($|[\s_-])/;

/** Where a seat number can live. The site shows it in a hover tooltip, i.e. usually an attribute. */
const SEAT_CODE_ATTRS = [
  'data-seat-name', 'data-seat', 'data-seat-number',
  'title', 'data-original-title', 'data-bs-original-title',
  'data-title', 'data-tooltip', 'data-tip', 'data-content', 'aria-label', 'alt'
];

const DIRECT_CODE_ATTRS = ['data-seat-name', 'data-seat', 'data-seat-number'];

const SEAT_CODE_FULL_RE = /^([A-Z\u0980-\u09FF]{1,5}[-_\s]?)?\d{1,3}[A-Z]?(?:\(B\))?$/i;
const SEAT_CODE_EMBEDDED_RE = /([A-Z\u0980-\u09FF]{1,5}\s?-\s?\d{1,3}[A-Z]?)/i;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class SeatMapParser {
  /**
   * Updates DOM attributes on page to reflect whether a seat element can be selected by DOM.
   * If unavailable, sets attributes and classes marking disabled DOM selection.
   */
  public static applyDOMSelectionState(el: HTMLElement | Element, isAvailable: boolean): void {
    if (!el || typeof el.setAttribute !== 'function') return;

    if (!isAvailable) {
      el.setAttribute('data-dom-selectable', 'false');
      el.setAttribute('aria-disabled', 'true');
      if (el.classList) {
        el.classList.add('dom-selection-disabled');
      }
    } else {
      el.setAttribute('data-dom-selectable', 'true');
      if (el.getAttribute('aria-disabled') === 'true' && !el.hasAttribute('disabled')) {
        el.removeAttribute('aria-disabled');
      }
      if (el.classList) {
        el.classList.remove('dom-selection-disabled');
      }
    }
  }

  /**
   * Returns true if DOM can touch and select this seat element.
   * Returns false if seat is unavailable, booked, in progress, selected, or marked disabled.
   */
  public static canDOMSelect(el: HTMLElement | Element): boolean {
    if (!el) return false;
    const domAttr = el.getAttribute('data-dom-selectable');
    if (domAttr === 'false') return false;
    const st = this.classify(el);
    return !st.booked && !st.inProgress && !st.selected;
  }

  /**
   * Parse seat elements from the live seat page (or a simulated DOM for unit tests).
   * Only the coach currently shown in the "Select Coach" dropdown is on the page, so the
   * result normally contains one CoachSeatMap.
   */
  public static parseFromDOM(container: HTMLElement | Document = document): CoachSeatMap[] {
    const defaultCoachName = this.detectCoachName(container);

    // 1. Candidate elements
    const candidateSelectors = [
      '.seat-layout *', '.seat-plan *', '#seat_map *', '[class*="seat-grid"] *',
      '[class*="seat-layout"] *', '[class*="seat-view"] *', '[class*="coach-layout"] *',
      '[class*="seat-matrix"] *', '[class*="seats-container"] *', '[class*="seat-details"] *',
      '.all-seats *', '.seat-available', '.seat-booked', '.seat-selected', '[data-seat-name]',
      '[data-seat]', 'button[class*="seat"]', 'div[class*="seat-item"]', '.coach-seat-btn',
      '.seat-details', '.single-seat', '[class*="seat" i]'
    ];

    let rawElements = Array.from(container.querySelectorAll(candidateSelectors.join(', '))) as HTMLElement[];
    if (rawElements.length === 0) {
      rawElements = Array.from(container.querySelectorAll('button, div, span, li, a, td')) as HTMLElement[];
    }

    // 2. Keep only individual seats
    let seatElements = rawElements.filter(el => this.looksLikeSeat(el));

    // 3. A seat is often `<button class="seat-x"><span>12</span></button>` — keep ONE element per seat
    seatElements = this.dedupeNested(seatElements);

    // 4. Build SeatInfo
    const groups: Map<string, { seat: SeatInfo; rect: Rect }[]> = new Map();

    seatElements.forEach((el, index) => {
      const code = this.extractSeatCode(el);
      const seatName = code || `S-${index + 1}`; // tooltip-only seats we cannot read → stable synthetic name

      const coachName =
        el.getAttribute('data-coach') ||
        el.closest('[data-coach-name]')?.getAttribute('data-coach-name') ||
        defaultCoachName;

      const rectRaw = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const rect: Rect = {
        left: rectRaw ? rectRaw.left : 0,
        top: rectRaw ? rectRaw.top : 0,
        width: rectRaw ? rectRaw.width : 0,
        height: rectRaw ? rectRaw.height : 0
      };

      const st = this.classify(el);
      const isAvailable = !st.booked && !st.inProgress && !st.selected;

      // Update DOM element visual & attribute state for DOM selection
      this.applyDOMSelectionState(el, isAvailable);

      const seatsPerRow = this.detectSeatsPerRow(coachName, container);

      const seat: SeatInfo = {
        id: `${coachName}_${seatName}`,
        name: seatName,
        coach: coachName,
        row: Math.floor(index / seatsPerRow) + 1, // overwritten by geometry when available
        col: (index % seatsPerRow) + 1,
        // ONLY "Available" seats are pickable. Booked / In Progress / already-Selected are not.
        isAvailable,
        isSelected: st.selected || st.active,
        canDOMSelect: isAvailable,
        xPos: rect.left,
        yPos: rect.top,
        rawElement: el
      };

      if (!groups.has(coachName)) groups.set(coachName, []);
      groups.get(coachName)!.push({ seat, rect });
    });

    const result: CoachSeatMap[] = [];
    groups.forEach((items, coachName) => {
      this.assignGrid(items);
      const seats = items.map(i => i.seat);
      result.push({
        coachName,
        seats,
        rows: Math.max(...seats.map(s => s.row), 1),
        cols: Math.max(...seats.map(s => s.col), 1)
      });
    });

    return result;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Coach name
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Detect expected seats per row for fallback grid assignment based on coach name or seat class.
   *  - AC_B / F_BERTH (First Berth / AC Berth): 2 seats per row
   *  - AC_S (AC Seat / Sleeper 3-berth): 3 seats per row
   *  - Standard Chair car (S_CHAIR, SNIGDHA, etc.): 4 seats per row
   */
  public static detectSeatsPerRow(coachName: string = '', container?: HTMLElement | Document | null): number {
    const name = (coachName || '').toUpperCase();

    let activeClass = '';
    const targetDoc = container || (typeof document !== 'undefined' ? document : null);
    if (targetDoc && typeof (targetDoc as any).querySelectorAll === 'function') {
      const selectElements = Array.from((targetDoc as any).querySelectorAll('select')) as HTMLSelectElement[];
      for (const sel of selectElements) {
        const selectedOpt = sel.selectedOptions ? sel.selectedOptions[0] : sel.options[sel.selectedIndex];
        if (selectedOpt) {
          const txt = (selectedOpt.text || selectedOpt.value).toUpperCase();
          if (txt.includes('AC_B') || txt.includes('AC B') || txt.includes('BERTH')) {
            activeClass = 'AC_B';
            break;
          }
          if (txt.includes('AC_S') || txt.includes('AC S')) {
            activeClass = 'AC_S';
            break;
          }
        }
      }
    }

    const check = `${name} ${activeClass}`;

    if (/AC[-_]?B|F[-_]?BERTH|BERTH|2[-_]?SEAT/i.test(check)) {
      return 2;
    }
    if (/AC[-_]?S|SLEEPER|3[-_]?SEAT/i.test(check)) {
      return 3;
    }
    return 4;
  }

  private static detectCoachName(container: HTMLElement | Document): string {
    let name = 'COACH-1';
    if (typeof document === 'undefined') return name;

    const selectElements = Array.from(container.querySelectorAll('select'));
    for (const sel of selectElements) {
      const selectedOpt = sel.selectedOptions ? sel.selectedOptions[0] : sel.options[sel.selectedIndex];
      if (!selectedOpt) continue;

      const text = (selectedOpt.text || selectedOpt.value).toUpperCase();
      if (text.includes('SEAT') || text.includes('AVAILABLE') || text.includes('COACH')) {
        // "GA - 17 Seat(s)" → "GA"
        const clean = text.split('(')[0].split('-')[0].replace(/SEAT.*/i, '').trim();
        if (clean && !clean.includes('SELECT') && !clean.includes('CHOOSE')) {
          name = clean;
          break;
        }
      }
    }
    return name;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Seat recognition
  // ────────────────────────────────────────────────────────────────────────

  /** Normalise a raw string into a seat code like "GA-12", or null. */
  private static normalizeCode(raw: string | null | undefined, allowEmbedded: boolean): string | null {
    let s = (raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return null;

    s = s.replace(/^seat\s*(no\.?|number|#)?\s*[:\-]?\s*/i, '').trim();
    if (!s) return null;

    if (s.length <= 12 && SEAT_CODE_FULL_RE.test(s)) return s.replace(/\s+/g, '');

    if (allowEmbedded) {
      const m = s.match(SEAT_CODE_EMBEDDED_RE);
      if (m) return m[1].replace(/\s+/g, '');
    }
    return null;
  }

  /** Read the seat number from data-attrs / tooltip attrs first, then visible text. */
  private static extractSeatCode(el: HTMLElement): string | null {
    for (const attr of DIRECT_CODE_ATTRS) {
      const v = el.getAttribute(attr);
      if (v && v.trim().length > 0 && v.trim().length <= 12) return v.trim();
    }
    for (const attr of SEAT_CODE_ATTRS) {
      const code = this.normalizeCode(el.getAttribute(attr), true);
      if (code) return code;
    }
    return this.normalizeCode(el.textContent, false);
  }

  public static classify(el: Element) {
    const cls = (el.getAttribute('class') || '').toLowerCase();
    const attrs = ['data-status', 'data-state', 'data-seat-status', 'title', 'data-original-title', 'aria-label', 'style', 'color']
      .map(a => (el.getAttribute(a) || '').toLowerCase())
      .join(' ');
    const all = `${cls} ${attrs}`.replace(/un-?selected|not[-_ ]selected/g, ' ');

    const booked =
      BOOKED_RE.test(all) ||
      el.hasAttribute('disabled') ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.getAttribute('data-dom-selectable') === 'false';

    const inProgress = IN_PROGRESS_RE.test(all);

    const selected =
      SELECTED_RE.test(all) ||
      el.getAttribute('aria-pressed') === 'true' ||
      el.getAttribute('aria-checked') === 'true';

    const active = ACTIVE_RE.test(cls);
    const hasAvailableClass = AVAILABLE_RE.test(cls);

    return { booked, inProgress, selected, active, hasAvailableClass };
  }

  private static looksLikeSeat(el: HTMLElement): boolean {
    // Legend squares ("Available / Selected / In Progress / Booked") are not seats
    if (el.closest('[class*="legend" i]')) return false;

    // A seat has at most ONE child that carries text (icon + number is fine, a wrapper is not)
    const textChildren = Array.from(el.children).filter(c => (c.textContent || '').trim()).length;
    if (el.children.length > 2 || textChildren > 1) return false;

    // Legend labels
    const text = (el.textContent || '').trim();
    if (/^(available|selected|in progress|booked|unavailable)$/i.test(text)) return false;

    // Readable seat number (attribute/tooltip/text)
    if (this.extractSeatCode(el)) return true;

    // Tooltip-only seat: no readable number, but the element is clearly a seat by class + state
    const cls = (el.getAttribute('class') || '').toLowerCase();
    if (/seat/.test(cls) && !/seat-?(layout|grid|plan|map|view|matrix|container|details|legend)/.test(cls)) {
      const st = this.classify(el);
      return st.booked || st.inProgress || st.selected || st.hasAvailableClass;
    }
    return false;
  }

  private static seatScore(el: HTMLElement): number {
    const st = this.classify(el);
    const hasState = st.booked || st.inProgress || st.selected || st.hasAvailableClass;
    let score = 0;
    if (hasState) score += 4;
    if (/^(BUTTON|A|INPUT)$/.test(el.tagName)) score += 2;
    if (/seat/i.test(el.getAttribute('class') || '')) score += 1;
    return score;
  }

  /** If a seat element contains another seat element with the same number, keep only the better one. */
  private static dedupeNested(elements: HTMLElement[]): HTMLElement[] {
    const kept: HTMLElement[] = [];
    for (const el of elements) {
      const code = this.extractSeatCode(el);
      const idx = kept.findIndex(k => (k.contains(el) || el.contains(k)) && this.extractSeatCode(k) === code);
      if (idx === -1) {
        kept.push(el);
      } else if (this.seatScore(el) > this.seatScore(kept[idx])) {
        kept[idx] = el;
      }
    }
    return kept;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Row / column detection
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Derive row/col from where each seat is actually drawn.
   *
   *  - rows  = seats whose top edge is (nearly) the same
   *  - cols  = horizontal position divided by the seat pitch, so an AISLE leaves a gap
   *            in the numbering (2 | 4). "Adjacent" (col diff === 1) therefore never
   *            pairs seats on opposite sides of the aisle.
   *
   * Falls back to "4 per row in DOM order" when the page is not laid out (hidden tab, tests).
   */
  private static assignGrid(items: { seat: SeatInfo; rect: Rect }[]): void {
    const measurable = items.filter(i => i.rect.width > 0 && i.rect.height > 0);
    if (items.length === 0 || measurable.length < Math.ceil(items.length * 0.8)) return; // keep index-based grid

    const median = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const medianH = median(measurable.map(i => i.rect.height));
    const medianW = median(measurable.map(i => i.rect.width));

    const sorted = [...measurable].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const rows: { top: number; items: { seat: SeatInfo; rect: Rect }[] }[] = [];

    for (const it of sorted) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(it.rect.top - last.top) <= Math.max(4, medianH * 0.5)) {
        last.items.push(it);
      } else {
        rows.push({ top: it.rect.top, items: [it] });
      }
    }

    // pitch = the smallest horizontal step between neighbouring seats (aisles are bigger steps)
    const steps: number[] = [];
    rows.forEach(r => {
      r.items.sort((a, b) => a.rect.left - b.rect.left);
      for (let i = 1; i < r.items.length; i++) {
        const dx = r.items[i].rect.left - r.items[i - 1].rect.left;
        if (dx > 2) steps.push(dx);
      }
    });
    const pitch = Math.max(steps.length ? Math.min(...steps) : medianW, medianW * 0.5, 1);
    const minLeft = Math.min(...measurable.map(i => i.rect.left));

    rows.forEach((r, rowIdx) => {
      r.items.forEach(it => {
        it.seat.row = rowIdx + 1;
        it.seat.col = 1 + Math.round((it.rect.left - minLeft) / pitch);
      });
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Debug helpers
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Text picture of a parsed coach, one line per row: `name` = available, `name*` = selected,
   * `namex` = booked / in progress, `|` = aisle. Log this to verify the parser matches
   * what you see on the page.
   */
  public static formatGrid(coach: CoachSeatMap): string {
    const rows = new Map<number, SeatInfo[]>();
    coach.seats.forEach(s => {
      if (!rows.has(s.row)) rows.set(s.row, []);
      rows.get(s.row)!.push(s);
    });

    const lines: string[] = [];
    Array.from(rows.keys()).sort((a, b) => a - b).forEach(r => {
      const seats = rows.get(r)!.sort((a, b) => a.col - b.col);
      let line = `R${String(r).padStart(2, '0')}: `;
      seats.forEach((s, i) => {
        if (i > 0) line += s.col - seats[i - 1].col > 1 ? '  |  ' : ' ';
        line += s.name + (s.isSelected ? '*' : s.isAvailable ? '' : 'x');
      });
      lines.push(line);
    });
    return lines.join('\n');
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