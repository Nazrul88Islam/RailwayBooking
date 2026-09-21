import { SeatInfo, CoachSeatMap } from './SeatTypes';

/**
 * Seat status detection.
 *
 * The Railway legend has FOUR states: Available (white, navy border), Selected (navy),
 * In Progress (green) and Booked (orange). Booked / In Progress seats are DISABLED in the
 * page's DOM — that real disabled state is the primary signal (see isDomDisabled), then class
 * names (below), then the drawn colour. Only "Available" seats may ever be picked.
 *
 * The parser only READS the page. It never writes attributes/classes onto Railway's elements
 * (an earlier version did, and then read its own marks back as "booked").
 */
const BOOKED_RE = /booked|occupied|sold|taken|unavailable|disabled|blocked/;
const IN_PROGRESS_RE = /progress|pending|processing|on[-_ ]?hold|(^|[\s_-])hold(ing)?($|[\s_-])|reserved|locked/;
const SELECTED_RE = /(^|[\s_-])selected($|[\s_-])/;
const ACTIVE_RE = /(^|[\s_-])(active|chosen|checked)($|[\s_-])/;
const AVAILABLE_RE = /(^|[\s_-])available($|[\s_-])/;

/** Where a seat number can live: attributes / tooltip attributes first, then visible text. */
const SEAT_CODE_ATTRS = [
  'data-seat-name', 'data-seat', 'data-seat-number',
  'title', 'data-original-title', 'data-bs-original-title',
  'data-title', 'data-tooltip', 'data-tip', 'data-content', 'aria-label', 'alt'
];
const DIRECT_CODE_ATTRS = ['data-seat-name', 'data-seat', 'data-seat-number'];

const SEAT_CODE_FULL_RE = /^([A-Z\u0980-\u09FF]{1,5}[-_\s]?)?\d{1,3}[A-Z]?(?:\(B\))?$/i;
const SEAT_CODE_EMBEDDED_RE = /([A-Z\u0980-\u09FF]{1,5}\s?-\s?\d{1,3}[A-Z]?)/i;
/** "KHA-1", "CHA-25": coach prefix + hyphen + number — what the real seat labels look like. */
const STRICT_CODE_RE = /^[A-Z\u0980-\u09FF]{1,5}-\d{1,3}$/i;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type ColorState = 'booked' | 'progress' | 'selected' | null;

export class SeatMapParser {
  /**
   * Seat class being booked (e.g. "AC_S"). Only used to guess the grid when the page is not
   * laid out (so seat positions cannot be measured).
   */
  public static seatClassHint = '';

  // ────────────────────────────────────────────────────────────────────────
  // Main parse
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Parse the seats of the coach currently shown on the seat page.
   * Only the seat GRID is parsed — never the "Seat Details" cart, the legend, or any table.
   */
  public static parseFromDOM(container: HTMLElement | Document = document): CoachSeatMap[] {
    const coachSelect = this.findCoachSelectElement(container);
    const defaultCoachName = this.detectCoachName(container);
    const cartPanel = this.findSeatDetailsPanel(container, coachSelect);

    // 1. Candidate elements
    const candidateSelectors = [
      '.seat-layout *', '.seat-plan *', '#seat_map *', '[class*="seat-grid"] *',
      '[class*="seat-layout"] *', '[class*="seat-view"] *', '[class*="coach-layout"] *',
      '[class*="seat-matrix"] *', '[class*="seats-container"] *',
      '.all-seats *', '.seat-available', '.seat-booked', '.seat-selected', '[data-seat-name]',
      '[data-seat]', 'button[class*="seat"]', 'div[class*="seat-item"]', '.coach-seat-btn',
      '.single-seat', '[class*="seat" i]'
    ];

    let rawElements = Array.from(container.querySelectorAll(candidateSelectors.join(', '))) as HTMLElement[];
    // No recognisable seat classes → look at every small element (filtered strictly below)
    if (!rawElements.some(el => this.isStrictSeatCode(this.extractSeatCode(el)))) {
      rawElements = Array.from(container.querySelectorAll('button, div, span, li, a, td')) as HTMLElement[];
    }

    // 2. Keep only individual seats — never the cart panel / cart table / legend
    let seatElements = rawElements.filter(el => !this.isExcluded(el, cartPanel) && this.looksLikeSeat(el));

    // 3. A seat is often `<button><span>12</span></button>` — keep ONE element per seat
    seatElements = this.dedupeNested(seatElements);

    // 4. Real seat labels are "KHA-12". If any exist, ignore bare numbers (prices, counters…)
    const strict = seatElements.filter(el => this.isStrictSeatCode(this.extractSeatCode(el)));
    if (strict.length > 0) seatElements = strict;

    // 5. Only seats of the coach selected in the dropdown (drops stale seats mid-switch)
    if (defaultCoachName !== 'COACH-1') {
      const sameCoach = seatElements.filter(
        el => this.extractCoachPrefixFromSeatCode(this.extractSeatCode(el) || '') === defaultCoachName
      );
      if (sameCoach.length > 0) seatElements = sameCoach;
    }

    // 6. Build SeatInfo
    const groups: Map<string, { seat: SeatInfo; rect: Rect }[]> = new Map();

    seatElements.forEach((el, index) => {
      const code = this.extractSeatCode(el);
      const seatName = code || `S-${index + 1}`; // tooltip-only seats we cannot read → stable synthetic name

      const coachName =
        el.getAttribute('data-coach') ||
        el.closest('[data-coach-name]')?.getAttribute('data-coach-name') ||
        (defaultCoachName !== 'COACH-1' ? defaultCoachName : null) ||
        this.extractCoachPrefixFromSeatCode(seatName) ||
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

      const seatsPerRow = this.detectSeatsPerRow(coachName);
      const fallbackGrid = this.deriveGridFromSeatCode(seatName, index, seatsPerRow);

      const seat: SeatInfo = {
        id: `${coachName}_${seatName}`,
        name: seatName,
        coach: coachName,
        row: fallbackGrid.row, // overwritten by measured geometry when available
        col: fallbackGrid.col,
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
  // "Seat Details" cart — the authoritative list of what is currently selected
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Seat codes currently listed in the "Seat Details" table (across ALL coaches), e.g.
   * ['KA-6', 'TA-7']. Returns null when the panel cannot be found (then callers must fall back
   * to looking at the seat grid).
   *
   * Railway keeps selected seats when you switch coach, so this — not the grid of the coach on
   * screen — is the only reliable answer to "which seats will I actually be buying?".
   */
  public static readSeatDetailsCart(container: HTMLElement | Document = document): string[] | null {
    const coachSelect = this.findCoachSelectElement(container);
    const panel = this.findSeatDetailsPanel(container, coachSelect);
    if (!panel) return null;

    const scope = (panel.querySelector('table') || panel).cloneNode(true) as HTMLElement;
    scope.querySelectorAll('select, option, thead').forEach(n => n.remove());

    // Join cell by cell: plain textContent glues cells together ("S_CHAIR" + "KA-6" → "S_CHAIRKA-6")
    const leaves = Array.from(scope.querySelectorAll('*')).filter(e => e.children.length === 0);
    const text = leaves.length > 0
      ? leaves.map(e => (e.textContent || '').trim()).join(' | ')
      : (scope.textContent || '');
    const codes: string[] = [];
    const re = /\b([A-Z]{1,5})-(\d{1,3})(?!\d)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const code = `${m[1]}-${m[2]}`.toUpperCase();
      if (!codes.includes(code)) codes.push(code);
    }
    return codes;
  }

  /**
   * The right-hand "Seat Details" panel: the biggest ancestor of its heading that does NOT also
   * contain the coach dropdown (so it never swallows the seat grid).
   */
  public static findSeatDetailsPanel(
    container: HTMLElement | Document,
    coachSelect?: HTMLElement | null
  ): HTMLElement | null {
    const candidates = Array.from(
      container.querySelectorAll('h1,h2,h3,h4,h5,h6,p,div,span,strong,b,label,legend,caption,th')
    ) as HTMLElement[];
    const heading = candidates.find(
      el => el.children.length === 0 && /^seat details$/i.test((el.textContent || '').trim())
    );
    if (!heading) return null;

    let panel: HTMLElement = heading;
    let levels = 0;
    while (panel.parentElement && panel.parentElement !== document.body && panel.parentElement !== document.documentElement) {
      const parent: HTMLElement = panel.parentElement;
      if (coachSelect ? parent.contains(coachSelect) : levels >= 3) break;
      panel = parent;
      levels++;
    }
    return panel;
  }

  private static isExcluded(el: Element, cartPanel: HTMLElement | null): boolean {
    if (cartPanel && (cartPanel === el || cartPanel.contains(el))) return true;
    const table = el.closest('table');
    if (table) {
      const t = (table.textContent || '').toLowerCase();
      if (t.includes('fare') && /class|seats?/.test(t)) return true; // the cart table
    }
    return false;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Coach name
  // ────────────────────────────────────────────────────────────────────────

  private static findCoachSelectElement(container: HTMLElement | Document): HTMLSelectElement | null {
    const selects = Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];
    return (
      selects.find(sel =>
        Array.from(sel.options).some(o => /SEAT|COACH|BOGIE|BOGEY/i.test(o.text || o.value || ''))
      ) || null
    );
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

  /** "KA-6" → "KA", "THA-15" → "THA". Returns null for synthetic names like "S-1". */
  public static extractCoachPrefixFromSeatCode(seatCode: string): string | null {
    if (!seatCode) return null;
    const m = seatCode.match(/^([A-Z\u0980-\u09FF]+)[-_ ]?\d+/i);
    if (m && m[1]) {
      const prefix = m[1].toUpperCase();
      if (prefix === 'S') return null;
      return prefix;
    }
    return null;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Seat recognition
  // ────────────────────────────────────────────────────────────────────────

  private static isStrictSeatCode(code: string | null): boolean {
    return !!code && STRICT_CODE_RE.test(code);
  }

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

  /** Read the seat number from data-attrs / tooltip attrs first, then visible text ("KHA-1"). */
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

  // ────────────────────────────────────────────────────────────────────────
  // Seat state (read-only)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * True if the page itself treats this seat as not clickable: `disabled` attribute / :disabled,
   * aria-disabled from the site, or CSS that blocks the pointer.
   */
  private static isDomDisabled(el: Element): boolean {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return true;
    try {
      if (el.matches(':disabled')) return true;
    } catch { /* selector unsupported */ }

    const parent = el.parentElement;
    if (parent && (parent.hasAttribute('disabled') || parent.getAttribute('aria-disabled') === 'true')) return true;
    if (el.querySelector('input:disabled, button:disabled')) return true;

    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const cs = window.getComputedStyle(el as HTMLElement);
        if (cs.pointerEvents === 'none' || cs.cursor === 'not-allowed') return true;
      } catch { /* ignore */ }
    }
    return false;
  }

  /** Legend colours: orange = booked, green = in progress, navy fill = selected. */
  private static colorState(el: Element): ColorState {
    if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return null;
    let bg = '';
    try {
      bg = window.getComputedStyle(el as HTMLElement).backgroundColor || '';
    } catch {
      return null;
    }
    const m = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/i);
    if (!m) return null;
    const r = +m[1], g = +m[2], b = +m[3];
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a < 0.5) return null;

    if (r >= 190 && g >= 90 && g <= 190 && b <= 110 && r - b >= 100) return 'booked';      // orange
    if (g >= 110 && r <= 150 && b <= 100 && g - r >= 30 && g - b >= 50) return 'progress';   // green
    if (r <= 100 && g <= 110 && b <= 140 && b - r >= 15 && r + g + b < 330) return 'selected'; // navy
    return null;
  }

  public static classify(el: Element) {
    const cls = (el.getAttribute('class') || '').toLowerCase();
    const attrs = ['data-status', 'data-state', 'data-seat-status', 'title', 'data-original-title', 'aria-label']
      .map(a => (el.getAttribute(a) || '').toLowerCase())
      .join(' ');
    const all = `${cls} ${attrs}`.replace(/un-?selected|not[-_ ]selected/g, ' ');
    const color = this.colorState(el);

    const booked = BOOKED_RE.test(all) || this.isDomDisabled(el) || color === 'booked';
    const inProgress = IN_PROGRESS_RE.test(all) || color === 'progress';

    const input = el.matches('input') ? (el as HTMLInputElement) : (el.querySelector('input') as HTMLInputElement | null);
    const selected =
      SELECTED_RE.test(all) ||
      el.getAttribute('aria-pressed') === 'true' ||
      el.getAttribute('aria-checked') === 'true' ||
      !!(input && input.checked) ||
      color === 'selected';

    const active = ACTIVE_RE.test(cls);
    const hasAvailableClass = AVAILABLE_RE.test(cls);

    return { booked, inProgress, selected, active, hasAvailableClass };
  }

  /**
   * Read-only check used right before clicking: does the live element look clickable
   * (not disabled, not booked, not in progress, not already selected)?
   */
  public static canDOMSelect(el: HTMLElement | Element): boolean {
    if (!el) return false;
    const st = this.classify(el);
    return !st.booked && !st.inProgress && !st.selected;
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
   * Expected seats per row when the page cannot be measured:
   *   AC_B → 2 per row,  AC_S → 3 per row,  chair cars (S_CHAIR, SNIGDHA, …) → 4 per row.
   */
  public static detectSeatsPerRow(coachName: string = ''): number {
    const hint = `${this.seatClassHint} ${coachName}`.toUpperCase();
    if (/AC[-_ ]?B(?![A-Z])|F[-_ ]?BERTH|BERTH/.test(hint)) return 2;
    if (/AC[-_ ]?S(?![A-Z])|SLEEPER/.test(hint)) return 3;
    return 4;
  }

  /**
   * Row/col from the seat number when geometry is unavailable.
   * Chair car: row 1 = 1,2 | 3 ; then 4 per row (4,5 | 6,7 ; 8,9 | 10,11 …) — matches the real map.
   */
  public static deriveGridFromSeatCode(seatName: string, index: number, seatsPerRow: number): { row: number; col: number } {
    const match = seatName.match(/\d+/);
    if (!match) {
      return { row: Math.floor(index / seatsPerRow) + 1, col: (index % seatsPerRow) + 1 };
    }
    const num = parseInt(match[0], 10);

    if (seatsPerRow === 4) {
      if (num === 1) return { row: 1, col: 1 };
      if (num === 2) return { row: 1, col: 2 };
      if (num === 3) return { row: 1, col: 5 };
      if (num >= 4) {
        const offset = (num - 4) % 4;
        const r = 2 + Math.floor((num - 4) / 4);
        const c = offset < 2 ? offset + 1 : offset + 2; // 0→1, 1→2, 2→4 (aisle gap), 3→5
        return { row: r, col: c };
      }
    }

    return {
      row: Math.floor((num - 1) / seatsPerRow) + 1,
      col: ((num - 1) % seatsPerRow) + 1
    };
  }

  /**
   * Derive row/col from where each seat is actually drawn.
   *
   *  - rows: seats with (nearly) the same top edge. A bigger vertical gap (compartment break)
   *          leaves a gap in the row numbers, so seats across it are never "next rows".
   *  - cols: horizontal position ÷ seat pitch. An AISLE leaves a gap in the numbering, so
   *          "adjacent" (col diff === 1) never pairs seats on opposite sides of it.
   *
   * Falls back to seat-number based grid when the page is not laid out.
   */
  private static assignGrid(items: { seat: SeatInfo; rect: Rect }[]): void {
    const measurable = items.filter(i => i.rect.width > 0 && i.rect.height > 0);
    if (items.length === 0 || measurable.length < Math.ceil(items.length * 0.8)) return;

    const median = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const medianH = median(measurable.map(i => i.rect.height));
    const medianW = median(measurable.map(i => i.rect.width));

    type Item = { seat: SeatInfo; rect: Rect };
    const sorted = [...measurable].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const rows: { top: number; items: Item[] }[] = [];

    for (const it of sorted) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(it.rect.top - last.top) <= Math.max(6, medianH * 0.5)) {
        last.items.push(it);
      } else {
        rows.push({ top: it.rect.top, items: [it] });
      }
    }

    // ── rows (with gaps) ──
    const dys: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const dy = rows[i].top - rows[i - 1].top;
      if (dy > 2) dys.push(dy);
    }
    const rowPitch = Math.max(dys.length ? Math.min(...dys) : medianH, 1);
    let rowNo = 1;
    rows.forEach((r, i) => {
      if (i > 0) {
        const gap = r.top - rows[i - 1].top;
        rowNo += gap <= rowPitch * 1.4 ? 1 : Math.max(2, Math.round(gap / rowPitch));
      }
      r.items.forEach(it => { it.seat.row = rowNo; });
    });

    // ── columns (with aisle gaps) ──
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

    rows.forEach(r => {
      r.items.forEach(it => {
        it.seat.col = 1 + Math.round((it.rect.left - minLeft) / pitch);
      });
      // Guarantee a visible gap (aisle) always shows up as a gap in the numbering
      for (let i = 1; i < r.items.length; i++) {
        const dx = r.items[i].rect.left - r.items[i - 1].rect.left;
        const diff = r.items[i].seat.col - r.items[i - 1].seat.col;
        if (dx > pitch * 1.4 && diff < 2) {
          const shift = 2 - diff;
          for (let j = i; j < r.items.length; j++) r.items[j].seat.col += shift;
        }
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Debug helpers
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Text picture of a parsed coach, one line per row: `name` = available, `name*` = selected,
   * `namex` = booked / in progress, `|` = aisle or gap.
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