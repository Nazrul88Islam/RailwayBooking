import { RAILWAY_SELECTORS } from './selectors';
import { BookingSettings } from '../../shared/types';

/** One real entry of the "Select Coach" dropdown, e.g. "GA - 17 Seat(s)". */
export interface CoachOption {
  index: number;
  value: string;
  label: string;
  coachName: string;
  available: number;
}

/** Parsed form of the "target train" text the user typed (name and/or number). */
export interface TargetTrainQuery {
  number: string;
  tokens: string[];
}

export class RailwayAdapter {
  /** Human-readable reason the last findAndSelectTargetTrain() call returned false (used for logging). */
  public static lastFailureReason = '';

  private static readonly TRAIN_CARD_SELECTOR =
    '.single-train-details, .train-item, .train-card, .search-result-item, [class*="single-train"], [class*="train-item"]';

  private static readonly CLICKABLE_SELECTOR =
    'button, a, input[type="button"], input[type="submit"], [role="button"]';

  /** All BD Railway class codes — used to tell which class a "Book" button belongs to. */
  private static readonly KNOWN_CLASSES = [
    'SNIGDHA', 'AC_S', 'AC_B', 'S_CHAIR', 'F_BERTH', 'F_SEAT', 'F_CHAIR', 'SHOVAN', 'SHULOV', 'AC_CHAIR'
  ];

  /** Elements we already clicked once to expand a card / class tab (never toggle twice). */
  private static readonly expandedOnce = new WeakSet<HTMLElement>();

  // ────────────────────────────────────────────────────────────────────────
  // Generic DOM helpers
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Find first matching DOM element from array of fallback selectors
   */
  public static findElement(selectors: string[]): HTMLElement | null {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el as HTMLElement;
    }
    return null;
  }

  /**
   * Find element by tag and text content or placeholder
   */
  public static findElementByText(tag: string, text: string): HTMLElement | null {
    const elements = Array.from(document.querySelectorAll(tag));
    for (const el of elements) {
      if (el.textContent?.toLowerCase().includes(text.toLowerCase()) ||
        el.getAttribute('placeholder')?.toLowerCase().includes(text.toLowerCase())) {
        return el as HTMLElement;
      }
    }
    return null;
  }

  private static normText(text: string | null | undefined): string {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  private static escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** True unless the browser reports the element as hidden (display:none, etc). */
  private static isVisible(el: HTMLElement): boolean {
    const anyEl = el as any;
    if (typeof anyEl.checkVisibility === 'function') {
      try {
        return !!anyEl.checkVisibility();
      } catch {
        return true;
      }
    }
    return true;
  }

  private static isEnabled(el: HTMLElement): boolean {
    if ((el as HTMLButtonElement).disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    const cls = (el.getAttribute('class') || '').toLowerCase();
    return !/(^|[\s_-])disabled($|[\s_-])/.test(cls);
  }

  /**
   * Set input value triggering React native value setter & synthetic events
   */
  public static setInputValue(inputEl: HTMLInputElement, value: string): void {
    const tracker = (inputEl as any)._valueTracker;
    if (tracker) {
      tracker.setValue('');
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(inputEl, value);
    } else {
      inputEl.value = value;
    }

    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Type text into input element character-by-character with randomized human delay
   */
  public static async typeWithHumanPacing(
    inputEl: HTMLInputElement,
    text: string,
    baseDelayMs: number,
    signal?: AbortSignal
  ): Promise<void> {
    inputEl.focus();
    inputEl.click();

    const tracker = (inputEl as any)._valueTracker;
    if (tracker) {
      tracker.setValue('');
    }

    if (baseDelayMs <= 100) {
      // Ultra Fast Instant Mode
      this.setInputValue(inputEl, text);
      inputEl.dispatchEvent(new Event('focus', { bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    } else {
      // Paced typing
      this.setInputValue(inputEl, '');
      inputEl.dispatchEvent(new Event('focus', { bubbles: true }));

      for (let i = 0; i < text.length; i++) {
        if (signal?.aborted) throw new Error('Automation aborted by user');

        const char = text.substring(0, i + 1);
        this.setInputValue(inputEl, char);
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: text[i], bubbles: true }));

        const variance = (Math.random() * 0.5 - 0.25) * baseDelayMs;
        const actualDelay = Math.max(10, Math.floor(baseDelayMs + variance));
        await new Promise(r => setTimeout(r, actualDelay));
      }
    }

    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  /**
   * Check if any security/verification prompts are currently visible on page
   */
  public static detectSafetyHalt(): 'CAPTCHA' | 'OTP' | 'PAYMENT' | null {
    const captchaEl = this.findElement(RAILWAY_SELECTORS.captchaContainer);
    if (captchaEl && captchaEl.offsetParent !== null) return 'CAPTCHA';

    const otpEl = this.findElement(RAILWAY_SELECTORS.otpContainer);
    if (otpEl && otpEl.offsetParent !== null) return 'OTP';

    const paymentEl = this.findElement(RAILWAY_SELECTORS.paymentContainer);
    if (paymentEl && paymentEl.offsetParent !== null) return 'PAYMENT';

    return null;
  }

  /**
   * Heuristic: is the user being asked to log in? (URL check + a *visible* password field).
   * Only used to produce a helpful error message — never to drive clicks.
   */
  public static detectLoginRequired(): boolean {
    if (/\/(login|signin|sign-in|auth)(\/|$|\?)/i.test(window.location.pathname)) return true;
    const pw = document.querySelector('input[type="password"]') as HTMLElement | null;
    return !!pw && this.isVisible(pw);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Homepage form helpers (unchanged behaviour)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Select station from dropdown or autocomplete list
   */
  public static async selectStation(
    type: 'from' | 'to',
    stationName: string,
    baseDelayMs: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    const selectors = type === 'from' ? RAILWAY_SELECTORS.fromStationInput : RAILWAY_SELECTORS.toStationInput;
    let inputEl = this.findElement(selectors) as HTMLInputElement;

    if (!inputEl) {
      inputEl = this.findElementByText('input', type === 'from' ? 'from' : 'to') as HTMLInputElement;
    }

    if (!inputEl) return false;

    await this.typeWithHumanPacing(inputEl, stationName, baseDelayMs, signal);

    // Wait brief moment for dropdown suggestions to open
    await new Promise(r => setTimeout(r, Math.min(baseDelayMs, 300)));

    // Click first suggestion if dropdown opened
    const dropdownItem = document.querySelector('.select2-results__option, .autocomplete-item, .ui-menu-item, [class*="option"], [class*="suggestion"], [class*="autocomplete"] li');
    if (dropdownItem) {
      (dropdownItem as HTMLElement).click();
    }

    return true;
  }

  /**
   * Format date string YYYY-MM-DD into DD-MMM-YYYY (e.g. 30-Sep-2026) for BD Railway URL
   */
  public static formatDojDate(dateStr: string): string {
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;

    const [yearStr, monthStr, dayStr] = parts;
    const monthNum = parseInt(monthStr, 10);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = monthNames[monthNum - 1] || 'Sep';
    const dayPadded = dayStr.padStart(2, '0');

    return `${dayPadded}-${monthName}-${yearStr}`;
  }

  /**
   * Direct navigation to search results URL if standard form submit is blocked or reloads home.
   * Only triggers if not already on the search results page.
   */
  public static navigateToSearchResults(
    fromStation: string,
    toStation: string,
    journeyDate: string,
    seatClass: string
  ): void {
    const formattedDate = this.formatDojDate(journeyDate);
    const targetUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(fromStation)}&tocity=${encodeURIComponent(toStation)}&doj=${encodeURIComponent(formattedDate)}&class=${encodeURIComponent(seatClass || 'SNIGDHA')}`;

    if (!window.location.href.includes('/booking/train/search')) {
      window.location.href = targetUrl;
    }
  }

  /**
   * Set journey date supporting React DatePickers, direct text inputs, and calendar overlays
   */
  public static async selectJourneyDate(
    dateStr: string,
    baseDelayMs: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    const inputEl = (this.findElement(RAILWAY_SELECTORS.datePickerInput) ||
      this.findElementByText('input', 'date')) as HTMLInputElement;

    if (!inputEl) return false;

    const parts = dateStr.split('-');
    if (parts.length < 3) return false;

    const [yearStr, monthStr, dayStr] = parts;
    const dayNum = parseInt(dayStr, 10);
    const monthNum = parseInt(monthStr, 10);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = monthNames[monthNum - 1] || 'Sep';

    const formatDDMMMYYYY = `${dayStr}-${monthName}-${yearStr}`; // 30-Sep-2026
    const formatYYYYMMDD = `${yearStr}-${monthStr}-${dayStr}`;   // 2026-09-30
    const formatDDMMYYYY = `${dayStr}/${monthStr}/${yearStr}`;   // 30/09/2026

    inputEl.focus();
    inputEl.click();
    await new Promise(r => setTimeout(r, 150));

    // Try primary format (DD-MMM-YYYY)
    this.setInputValue(inputEl, formatDDMMMYYYY);
    await new Promise(r => setTimeout(r, 100));

    if (!inputEl.value) {
      this.setInputValue(inputEl, formatYYYYMMDD);
      await new Promise(r => setTimeout(r, 100));
    }

    if (!inputEl.value) {
      this.setInputValue(inputEl, formatDDMMYYYY);
      await new Promise(r => setTimeout(r, 100));
    }

    // Check if calendar popover opened
    const calendarDays = Array.from(document.querySelectorAll(
      '.react-datepicker__day, .datepicker-day, .day-cell, [class*="day"]'
    ));

    const dayPad3 = dayStr.padStart(3, '0');
    const targetDayEl = calendarDays.find(el => {
      const cls = el.className || '';
      const txt = el.textContent?.trim();
      return (cls.includes(`--${dayPad3}`) || cls.includes(`--${dayStr}`) || txt === String(dayNum)) &&
        !cls.includes('disabled') && !cls.includes('outside');
    });

    if (targetDayEl) {
      (targetDayEl as HTMLElement).click();
    }

    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new Event('blur', { bubbles: true }));

    return true;
  }

  /**
   * Set HTMLSelectElement value triggering React native setter & events
   */
  public static setSelectValue(selectEl: HTMLSelectElement, value: string): void {
    const tracker = (selectEl as any)._valueTracker;
    if (tracker) {
      tracker.setValue('');
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(selectEl, value);
    } else {
      selectEl.value = value;
    }

    Array.from(selectEl.options).forEach((opt, idx) => {
      if (opt.value === value || opt.text === value || (value && opt.text.includes(value))) {
        opt.selected = true;
        opt.setAttribute('selected', 'selected');
        selectEl.selectedIndex = idx;
      } else {
        opt.selected = false;
        opt.removeAttribute('selected');
      }
    });

    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    selectEl.dispatchEvent(new Event('blur', { bubbles: true }));

    if (selectEl.form) {
      selectEl.form.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /**
   * Helper to normalize seat class variations (e.g. SNIGDHA, AC_S -> AC S, S_CHAIR -> S CHAIR)
   */
  public static getClassVariations(seatClass: string): string[] {
    const raw = (seatClass || '').trim().toUpperCase();
    const clean = raw.replace(/[^A-Z0-9]/g, '');
    const set = new Set<string>([raw, clean]);

    if (raw.includes('SNIGDHA') || clean.includes('SNIGDHA')) {
      ['SNIGDHA', 'SNIGDA', 'SNIDGHA', 'SNGDHA'].forEach(s => set.add(s));
    }
    if (raw.includes('AC_S') || raw.includes('AC S') || clean === 'ACS') {
      ['AC_S', 'AC S', 'AC_SEAT', 'AC SEAT', 'AC-S', 'ACS'].forEach(s => set.add(s));
    }
    if (raw.includes('AC_B') || raw.includes('AC B') || clean === 'ACB') {
      ['AC_B', 'AC B', 'AC_BERTH', 'AC BERTH', 'AC-B', 'ACB'].forEach(s => set.add(s));
    }
    if (raw.includes('S_CHAIR') || raw.includes('S CHAIR') || clean === 'SCHAIR') {
      ['S_CHAIR', 'S CHAIR', 'SHOVAN CHAIR', 'S-CHAIR', 'SCHAIR'].forEach(s => set.add(s));
    }
    if (raw.includes('F_BERTH') || clean === 'FBERTH') {
      ['F_BERTH', 'F BERTH', 'FIRST BERTH', 'F-BERTH', 'FBERTH'].forEach(s => set.add(s));
    }
    if (raw.includes('F_SEAT') || clean === 'FSEAT') {
      ['F_SEAT', 'F SEAT', 'FIRST SEAT', 'F-SEAT', 'FSEAT'].forEach(s => set.add(s));
    }
    if (raw.includes('F_CHAIR') || clean === 'FCHAIR') {
      ['F_CHAIR', 'F CHAIR', 'FIRST CHAIR', 'F-CHAIR', 'FCHAIR'].forEach(s => set.add(s));
    }
    if (raw.includes('SHOVAN')) {
      ['SHOVAN', 'SHOVAN_CHAIR'].forEach(s => set.add(s));
    }
    if (raw.includes('SHULOV')) {
      ['SHULOV'].forEach(s => set.add(s));
    }
    if (raw.includes('AC_CHAIR') || clean === 'ACCHAIR') {
      ['AC_CHAIR', 'AC CHAIR', 'ACCHAIR'].forEach(s => set.add(s));
    }

    return Array.from(set);
  }

  /**
   * Select train seat class from homepage dropdown
   */
  public static async selectClass(
    className: string,
    baseDelayMs: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    const selects = Array.from(document.querySelectorAll('select'));
    let selectEl: HTMLSelectElement | null = null;

    // Identify select element containing BD Railway class option values
    for (const sel of selects) {
      const optionTexts = Array.from(sel.options).map(o => (o.value || o.text).toUpperCase().trim());
      if (optionTexts.some(txt => txt === 'AC_B' || txt === 'AC_S' || txt === 'SNIGDHA' || txt === 'S_CHAIR' || txt === 'F_BERTH' || txt.includes('CHOOSE A CLASS') || txt.includes('CLASS'))) {
        selectEl = sel;
        break;
      }
    }

    if (!selectEl) {
      selectEl = (this.findElement(RAILWAY_SELECTORS.seatClassSelect) ||
        this.findElementByText('select', 'class') ||
        this.findElementByText('select', 'choose')) as HTMLSelectElement;
    }

    if (!selectEl) return false;

    const variations = this.getClassVariations(className);
    const options = Array.from(selectEl.options);

    const targetOption = options.find(opt => {
      const v = (opt.value || '').trim().toUpperCase();
      const t = (opt.text || '').trim().toUpperCase();
      return variations.some(varStr => v === varStr || t === varStr || v.includes(varStr) || t.includes(varStr));
    });

    if (targetOption) {
      selectEl.focus();
      selectEl.click();

      this.setSelectValue(selectEl, targetOption.value || targetOption.text);
      return selectEl.selectedIndex !== 0;
    }

    return false;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Target-train matching
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Parse "KALNI EXPRESS", "KALNI EXPRESS (773)", "773", "773 - KALNI EXPRESS" …
   */
  public static parseTargetTrain(target: string): TargetTrainQuery {
    const q = this.normText(target).toLowerCase();
    const number = q.match(/\b\d{2,5}\b/)?.[0] || '';
    const tokens = q
      .replace(/\b\d{2,5}\b/g, ' ')
      .replace(/\bexpress\b/g, ' ')
      .split(/[\s\-–—()_,.&/]+/)
      .filter(t => t.length >= 3);
    return { number, tokens };
  }

  /**
   * Does `text` describe the target train?
   *  - If the user supplied a train number: the number must appear as a standalone number
   *    (so "773" does NOT match "1,773" or "17730").
   *  - Otherwise every name word must appear.
   */
  public static matchesTrain(text: string, target: TargetTrainQuery): boolean {
    const t = this.normText(text).toLowerCase();
    if (!t) return false;

    if (target.number) {
      const re = new RegExp('(?<!\\d)(?<!\\d[,.])' + target.number + '(?!\\d)(?![,.]\\d)');
      if (re.test(t)) return true;
    }

    return target.tokens.length > 0 && target.tokens.every(tok => t.includes(tok));
  }

  /** Number of distinct "(701)"-style train codes in a chunk of text. */
  private static countTrainCodes(text: string): number {
    const codes = new Set<string>();
    const re = /\(\s*(\d{3})\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text || '')) !== null) codes.add(m[1]);
    return codes.size;
  }

  /**
   * Find the DOM card for the target train.
   *
   * IMPORTANT: the old code took the FIRST element (in document order) matching the card
   * selectors, which is the OUTERMOST one — often a wrapper around *all* trains. Here we pick
   * the innermost match and then climb only as far as needed to reach the Book buttons, and
   * never past an ancestor that contains another train.
   */
  private static findTrainCard(target: TargetTrainQuery): HTMLElement | null {
    let anchors = (Array.from(document.querySelectorAll(this.TRAIN_CARD_SELECTOR)) as HTMLElement[])
      .filter(el => this.matchesTrain(el.textContent || '', target));

    // Fallback when the site uses different class names: any small element whose text matches.
    if (!anchors.length) {
      anchors = (Array.from(document.body.querySelectorAll('*')) as HTMLElement[]).filter(el => {
        const txt = this.normText(el.textContent);
        return txt.length > 0 && txt.length < 200 && this.matchesTrain(txt, target);
      });
    }

    // Keep only innermost matches.
    anchors = anchors.filter(a => !anchors.some(b => b !== a && a.contains(b)));

    const hasBookingBtn = (el: HTMLElement) => this.getBookingCandidates(el).length > 0;

    // Pass 1: highest ancestor that still holds only ONE train and contains Book buttons.
    for (const anchor of anchors) {
      let el: HTMLElement | null = anchor;
      let best: HTMLElement | null = null;
      while (el && el !== document.body) {
        if (this.countTrainCodes(el.textContent || '') > 1) break;
        if (hasBookingBtn(el)) best = el;
        el = el.parentElement;
      }
      if (best) return best;
    }

    // Pass 2: nearest ancestor with any Book button (class-row matching validates it later).
    for (const anchor of anchors) {
      let el: HTMLElement | null = anchor;
      while (el && el !== document.body) {
        if (hasBookingBtn(el)) return el;
        el = el.parentElement;
      }
    }

    // Nothing has a button (collapsed card?) — return the card itself so we can try expanding it.
    return anchors[0] || null;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Seat-class matching
  // ────────────────────────────────────────────────────────────────────────

  private static textMatchesClass(text: string, cls: string): boolean {
    const up = this.normText(text).toUpperCase();
    return this.getClassVariations(cls)
      .filter(Boolean)
      .some(v => new RegExp('(?<![A-Z0-9])' + this.escapeRegex(v) + '(?![A-Z0-9])').test(up));
  }

  private static sameClass(a: string, b: string): boolean {
    const vb = new Set(this.getClassVariations(b).filter(Boolean));
    return this.getClassVariations(a).filter(Boolean).some(v => vb.has(v));
  }

  /**
   * Returns true if a candidate element has strong evidence it is a booking action button.
   * Evidence required: text or ARIA label must contain one of the booking intent keywords.
   * An element with no text, no aria-label, and no booking-related class is NOT accepted.
   */
  private static isBookingIntentElement(el: HTMLElement): boolean {
    const text = ((el.textContent || '') + ' ' + ((el as HTMLInputElement).value || '')).trim().toUpperCase();
    const ariaLabel = (el.getAttribute('aria-label') || '').toUpperCase();
    const className = (el.getAttribute('class') || '').toUpperCase();

    // Must carry explicit booking intent in text, aria-label, or class name
    const BOOKING_KEYWORDS = ['BOOK', 'PURCHASE', 'বুক', 'টিকেট', 'BUY', 'RESERVE'];
    const hasBookingIntent = BOOKING_KEYWORDS.some(kw =>
      text.includes(kw) || ariaLabel.includes(kw) || className.includes(kw)
    );

    if (!hasBookingIntent) return false;

    // Reject navigation/UI text that isn't a booking action
    const EXCLUDE_KEYWORDS = ['DETAILS', 'VIEW', 'SCHEDULE', 'INFO', 'MORE', 'SHARE', 'PRINT', 'CANCEL', 'CLOSE'];
    if (EXCLUDE_KEYWORDS.some(kw => text === kw || ariaLabel === kw)) return false;

    // Reject sold-out / already-booked labels
    if (/SOLD|UNAVAILABLE|NOT AVAILABLE|BOOKED/.test(text)) return false;

    return true;
  }

  /**
   * Returns true if an element's href (or its parent <a>'s href) does NOT point to the homepage or a void/hash URL.
   */
  public static isValidBookingHref(el: HTMLElement): boolean {
    const rawHref = el.getAttribute('href') || el.closest('a')?.getAttribute('href');
    if (!rawHref) return true; // Pure button / no href — pass through (text evidence is checked separately)
    const h = rawHref.toLowerCase().trim();
    if (h === '' || h === '#' || h === 'javascript:void(0)' || h === 'javascript:;') return false;
    if (h === '/' || h === '/#' || h === '/?' ||
      h === 'https://eticket.railway.gov.bd' ||
      h === 'https://eticket.railway.gov.bd/' ||
      h === 'https://eticket.railway.gov.bd/#') return false;
    if (h.startsWith('https://eticket.railway.gov.bd/?') || h.startsWith('/?')) return false;
    return true;
  }

  /** All visible booking-intent buttons/links inside a container (enabled or not). */
  private static getBookingCandidates(container: HTMLElement): HTMLElement[] {
    return (Array.from(container.querySelectorAll(this.CLICKABLE_SELECTOR)) as HTMLElement[]).filter(el =>
      this.isBookingIntentElement(el) &&
      this.isValidBookingHref(el) &&
      this.isVisible(el)
    );
  }

  /**
   * Find the Book button that belongs to the requested seat class inside a train card.
   *
   * For every candidate button we climb its ancestors until the ancestor's text mentions a
   * class name. That is the button's "class row". If the row mentions ONLY the requested class
   * the button is ours. If it mentions another class (or several) the button is not ours.
   *
   * (The old code took the first element in document order that mentioned the class — usually a
   * big wrapper holding every class row — and then clicked the first Book button inside it,
   * which could be a different class.)
   */
  private static findClassBookButton(
    card: HTMLElement,
    seatClass: string
  ): { button: HTMLElement | null; reason: string } {
    const candidates = this.getBookingCandidates(card);
    if (!candidates.length) {
      return { button: null, reason: 'No Book button visible inside the train card (card may be collapsed or still loading)' };
    }

    const others = this.KNOWN_CLASSES.filter(k => !this.sameClass(k, seatClass));
    let sawDisabled = false;

    for (const btn of candidates) {
      let node: HTMLElement | null = btn;
      while (node) {
        const text = node.textContent || '';
        const hitsTarget = this.textMatchesClass(text, seatClass);
        const hitsOther = others.some(k => this.textMatchesClass(text, k));

        if (hitsTarget && !hitsOther) {
          if (this.isEnabled(btn)) return { button: btn, reason: '' };
          sawDisabled = true;
          break;
        }
        if (hitsTarget || hitsOther) break; // belongs to another class, or a shared container
        if (node === card) break;
        node = node.parentElement;
      }
    }

    if (sawDisabled) {
      return { button: null, reason: `Book button for ${seatClass} is disabled (class sold out?)` };
    }
    return { button: null, reason: `No Book button found next to seat class '${seatClass}' in this train card` };
  }

  /**
   * If the card has no usable Book button yet, try ONE click to expand it:
   *   (a) a class tab/label whose text is exactly the requested class
   *   (b) the train header (only when the card shows no Book buttons at all)
   * Each element is clicked at most once so we never toggle a section closed again.
   */
  private static tryExpand(
    card: HTMLElement,
    seatClass: string,
    target: TargetTrainQuery,
    hasAnyBookingButton: boolean
  ): boolean {
    const safeToClick = (el: HTMLElement): boolean => {
      if (this.expandedOnce.has(el)) return false;
      const a = el.closest('a[href]');
      if (a) {
        const h = (a.getAttribute('href') || '').trim().toLowerCase();
        if (h && h !== '#' && !h.startsWith('javascript')) return false; // would navigate away
      }
      return true;
    };

    const nodes = Array.from(card.querySelectorAll('*')) as HTMLElement[];
    const variations = this.getClassVariations(seatClass).filter(Boolean);

    // Always click the INNERMOST matching element (the one that owns the click handler);
    // clicking an outer wrapper would not trigger listeners on its children.
    const innermost = (list: HTMLElement[]): HTMLElement | null =>
      list.find(a => !list.some(b => b !== a && a.contains(b))) || null;

    let toClick: HTMLElement | null = innermost(
      nodes.filter(el => {
        const t = this.normText(el.textContent).toUpperCase();
        return t.length > 0 && t.length <= 40 && variations.includes(t) && safeToClick(el);
      })
    );

    if (!toClick && !hasAnyBookingButton) {
      toClick = innermost(
        nodes.filter(el => {
          const t = this.normText(el.textContent);
          return t.length > 0 && t.length <= 120 && this.matchesTrain(t, target) && safeToClick(el);
        })
      );
    }

    if (!toClick) return false;

    this.expandedOnce.add(toClick);
    console.log('[Railway] Expanding card/class tab by clicking:', toClick);
    toClick.click();
    return true;
  }

  /**
   * Diagnostic helper — dumps all interactive elements within the matched train card to console.
   * Call this before attempting to click any booking element.
   */
  public static debugTrainCard(card: HTMLElement): void {
    console.group('[Railway] Target Train Card Diagnostics');
    console.log('Card Container Element:', card);

    const clickableElements = Array.from(
      card.querySelectorAll('button, a, input, [role="button"], [class*="book"]')
    );

    console.log(`Found ${clickableElements.length} clickable candidate element(s) in card:`);

    clickableElements.forEach((el, index) => {
      const element = el as HTMLElement;
      const dataAttrs: Record<string, string> = {};
      Array.from(element.attributes).forEach(attr => {
        if (attr.name.startsWith('data-')) {
          dataAttrs[attr.name] = attr.value;
        }
      });

      console.log(`  [Element #${index}]`, {
        tag: element.tagName,
        text: element.textContent?.trim(),
        value: (element as HTMLInputElement).value || undefined,
        href: element.getAttribute('href'),
        parentHref: element.closest('a')?.getAttribute('href'),
        className: element.className,
        id: element.id,
        role: element.getAttribute('role'),
        ariaLabel: element.getAttribute('aria-label'),
        dataAttributes: dataAttrs,
        bookingIntent: this.isBookingIntentElement(element),
        validHref: this.isValidBookingHref(element)
      });
    });

    console.groupEnd();
  }

  /**
   * Find target train card on search results page and click the seat-class Book Now button.
   *
   * Returns true if the correct class's Book button was found and clicked.
   * Returns false otherwise and sets RailwayAdapter.lastFailureReason.
   * Does NOT verify post-click navigation — that is AutomationEngine's job.
   */
  public static async findAndSelectTargetTrain(
    targetTrain: string,
    seatClass: string,
    baseDelayMs: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    this.lastFailureReason = '';

    const target = this.parseTargetTrain(targetTrain);
    console.log('[Railway] Target train:', { original: targetTrain, ...target, seatClass });

    if (!target.number && !target.tokens.length) {
      this.lastFailureReason = `Target train '${targetTrain}' has no usable name or number`;
      return false;
    }

    const card = this.findTrainCard(target);

    if (!card) {
      this.lastFailureReason = `Train '${targetTrain}' not found on the page yet`;
      console.warn('[Railway] ' + this.lastFailureReason, {
        url: window.location.href,
        bodyText: (document.body?.innerText || '').substring(0, 2000)
      });
      return false;
    }

    console.log('[Railway] Target train card found:', card);

    try {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      card.scrollIntoView();
    }

    this.debugTrainCard(card);

    const { button: targetBookBtn, reason } = this.findClassBookButton(card, seatClass);

    if (!targetBookBtn) {
      const hasAny = this.getBookingCandidates(card).length > 0;
      const soldOut = reason.includes('disabled');
      const expanded = soldOut ? false : this.tryExpand(card, seatClass, target, hasAny);
      this.lastFailureReason = reason + (expanded ? ' — clicked to expand, will retry' : '');
      console.warn('[Railway] ' + this.lastFailureReason);
      return false;
    }

    console.log('[Railway] Target booking button:', {
      train: targetTrain,
      seatClass,
      tag: targetBookBtn.tagName,
      text: targetBookBtn.textContent?.trim(),
      href: targetBookBtn.getAttribute('href'),
      className: targetBookBtn.className
    });

    try {
      targetBookBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      targetBookBtn.scrollIntoView();
    }

    await new Promise(resolve => setTimeout(resolve, Math.min(baseDelayMs, 300)));

    if (signal?.aborted) {
      throw new Error('Automation aborted by user');
    }

    targetBookBtn.focus();
    targetBookBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    targetBookBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    targetBookBtn.click();

    console.log(`[Railway] Book clicked for ${targetTrain} / ${seatClass}`);
    return true;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Seat-map page helpers
  // ────────────────────────────────────────────────────────────────────────

  /** Seat layout container or coach dropdown is present in the DOM. */
  public static isSeatMapVisible(): boolean {
    const container = document.querySelector(
      [
        '.seat-layout',
        '.seat-plan',
        '#seat_map',
        '[class*="seat-layout"]',
        '[class*="seat-grid"]',
        '[class*="coach-layout"]',
        '.coach-seat-btn'
      ].join(',')
    );
    if (container) return true;

    return Array.from(document.querySelectorAll('select')).some(sel => {
      const nameOrId = (sel.name || sel.id || sel.getAttribute('aria-label') || '').toLowerCase();
      const txt = (sel.textContent || '').toUpperCase();
      return (
        nameOrId.includes('coach') ||
        nameOrId.includes('bogey') ||
        txt.includes('SEAT(S)') ||
        txt.includes('SEATS AVAILABLE') ||
        txt.includes('CHOICE COACH')
      );
    });
  }

  /**
   * Click unselected coach tab/button to load coach seat grid
   */
  public static clickAvailableCoachTab(): boolean {
    const coachTabs = Array.from(document.querySelectorAll(
      '.coach-tab, .coach-btn, [class*="coach-select"], [class*="coach-tab"], .coach-list button, button[class*="coach"]'
    ));

    for (const tab of coachTabs) {
      const cls = (tab.className || '').toString().toLowerCase();
      if (!cls.includes('active') && !cls.includes('selected') && !cls.includes('disabled')) {
        (tab as HTMLElement).click();
        return true;
      }
    }
    return false;
  }

  private static findCoachSelect(): HTMLSelectElement | null {
    const selects = Array.from(document.querySelectorAll('select'));

    for (const sel of selects) {
      const nameOrId = (
        sel.name ||
        sel.id ||
        sel.getAttribute('aria-label') ||
        ''
      ).toLowerCase();

      const optionTexts = Array.from(sel.options)
        .map(o => (o.text || o.value).toUpperCase());

      const looksLikeCoach =
        nameOrId.includes('coach') ||
        nameOrId.includes('bogey') ||
        optionTexts.some(txt =>
          txt.includes('SEAT') ||
          txt.includes('AVAILABLE') ||
          txt.includes('COACH') ||
          txt.includes('BOGIE') ||
          txt.includes('BOGEY')
        );

      if (looksLikeCoach) return sel;
    }
    return null;
  }

  public static hasCoachDropdown(): boolean {
    return this.findCoachSelect() !== null;
  }

  /** "GA (20 Available)", "GA - 20 Seat(s)", "GA - 20 Seats", "GA (20)" → 20 */
  private static parseAvailableCount(optionText: string): number {
    const text = optionText.trim().toUpperCase();
    const matches = [
      text.match(/(\d+)\s*AVAILABLE/i),
      text.match(/(\d+)\s*SEAT/i),
      text.match(/\(\s*(\d+)\s*\)/),
      text.match(/[-:]\s*(\d+)/)
    ];
    for (const match of matches) {
      if (match) return parseInt(match[1], 10);
    }
    return 0;
  }

  /**
   * All real coach entries of the "Select Coach" dropdown, e.g.
   *   "GA - 17 Seat(s)" → { coachName: 'GA', available: 17 }
   * Placeholder ("Select Coach") and empty (0 seat) entries are skipped.
   * coachName is derived exactly like SeatMapParser does, so the two always agree.
   */
  public static getCoachOptions(): CoachOption[] {
    const sel = this.findCoachSelect();
    if (!sel) return [];

    const result: CoachOption[] = [];
    Array.from(sel.options).forEach((option, index) => {
      const label = (option.text || option.value || '').trim();
      const text = label.toUpperCase();
      if (!text) return;
      if (text.includes('SELECT') || text.includes('CHOOSE') || text.includes('OPTION')) return;

      const available = this.parseAvailableCount(text);
      if (available <= 0) return;

      const coachName = text.split('(')[0].split('-')[0].replace(/SEAT.*/i, '').trim();
      result.push({ index, value: option.value, label, coachName, available });
    });
    return result;
  }

  public static getSelectedCoachIndex(): number {
    const sel = this.findCoachSelect();
    return sel ? sel.selectedIndex : -1;
  }

  /** Switch the coach dropdown to the given option (matched by index — values can collide). */
  public static selectCoachOption(option: CoachOption): boolean {
    const sel = this.findCoachSelect();
    if (!sel || !sel.options[option.index]) return false;

    if (sel.selectedIndex === option.index) return true;

    sel.focus();
    this.setSelectValue(sel, option.value);

    // setSelectValue matches loosely (substring); force the exact option if it picked another one
    if (sel.selectedIndex !== option.index) {
      sel.selectedIndex = option.index;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return sel.selectedIndex === option.index;
  }

  /**
   * Select the coach with the most seats that still has at least `requiredSeats`.
   * (Kept for backwards compatibility; the engine now scans coaches with getCoachOptions().)
   */
  public static selectBestCoachFromDropdown(
    requiredSeats: number = 1
  ): boolean {
    const options = this.getCoachOptions().filter(o => o.available >= requiredSeats);
    if (!options.length) {
      console.warn(`[Railway] No coach has ${requiredSeats} available seat(s).`);
      return false;
    }
    const best = options.reduce((a, b) => (b.available > a.available ? b : a));
    console.log(`[Railway] Selecting coach "${best.label}" with ${best.available} available seat(s).`);
    return this.selectCoachOption(best);
  }

  /**
   * Find the Continue / Purchase button on the seat page. Text match first (most reliable),
   * class-based selectors as fallback. Skips hidden and disabled buttons.
   */
  public static findContinueButton(): HTMLElement | null {
    const all = Array.from(document.querySelectorAll(this.CLICKABLE_SELECTOR)) as HTMLElement[];
    const usable = all.filter(el => this.isVisible(el) && this.isEnabled(el));

    const labelOf = (el: HTMLElement) =>
      (this.normText(el.textContent) + ' ' + ((el as HTMLInputElement).value || '')).toUpperCase();

    for (const key of ['CONTINUE PURCHASE', 'CONTINUE', 'PURCHASE', 'PROCEED', 'CONFIRM']) {
      const hit = usable.find(el => labelOf(el).includes(key));
      if (hit) return hit;
    }

    const bySelector = [
      '.btn-continue',
      'button.continue-btn',
      '.proceed-btn',
      'button[type="submit"].btn-success',
      '.purchase-btn',
      '[class*="continue"]',
      '[class*="purchase"]'
    ];
    for (const sel of bySelector) {
      const el = Array.from(document.querySelectorAll(sel)).find(e =>
        this.isVisible(e as HTMLElement) && this.isEnabled(e as HTMLElement)
      );
      if (el) return el as HTMLElement;
    }
    return null;
  }
}