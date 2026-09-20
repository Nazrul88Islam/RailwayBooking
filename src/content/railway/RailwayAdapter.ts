import { RAILWAY_SELECTORS } from './selectors';
import { BookingSettings } from '../../shared/types';

export class RailwayAdapter {
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

  /**
   * Returns true if a candidate element has strong evidence it is a booking action button.
   * Evidence required: text or ARIA label must contain one of the booking intent keywords.
   * An element with no text, no aria-label, and no booking-related class is NOT accepted.
   */
  private static isBookingIntentElement(el: HTMLElement): boolean {
    const text = (el.textContent || '').trim().toUpperCase();
    const ariaLabel = (el.getAttribute('aria-label') || '').toUpperCase();
    const className = (el.className || '').toString().toUpperCase();

    // Must carry explicit booking intent in text, aria-label, or class name
    const BOOKING_KEYWORDS = ['BOOK', 'PURCHASE', 'বুক', 'টিকেট', 'BUY', 'RESERVE'];
    const hasBookingIntent = BOOKING_KEYWORDS.some(kw =>
      text.includes(kw) || ariaLabel.includes(kw) || className.includes(kw)
    );

    if (!hasBookingIntent) return false;

    // Reject navigation/UI text that isn't a booking action
    const EXCLUDE_KEYWORDS = ['DETAILS', 'VIEW', 'SCHEDULE', 'INFO', 'MORE', 'SHARE', 'PRINT', 'CANCEL', 'CLOSE'];
    if (EXCLUDE_KEYWORDS.some(kw => text === kw || ariaLabel === kw)) return false;

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
   * Find target train card on search results page and click the seat class Book Now button.
   *
   * Returns true if a booking-intent button was found and clicked.
   * Does NOT verify post-click navigation — that is the responsibility of AutomationEngine.
   *
   * Priority order:
   *   1. Button/link inside the matching seat-class sub-container with booking intent text + valid href
   *   2. Any button/link inside the whole train card with booking intent text + valid href
   *   -- NO generic "first button" fallback (too dangerous on React SPAs) --
   */
  public static async findAndSelectTargetTrain(
    targetTrain: string,
    seatClass: string,
    baseDelayMs: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    console.log(
      '[Railway] SEARCH PAGE DIAGNOSTICS',
      {
        url: window.location.href,
        title: document.title,
        bodyLength: document.body?.innerText?.length || 0,
        bodyText: (document.body?.innerText || '').substring(0, 5000)
      }
    );

    const query = targetTrain.trim().toLowerCase();

    // Support:
    // "KALNI EXPRESS"
    // "KALNI EXPRESS (773)"
    // "773"
    // "773 - KALNI EXPRESS"
    const trainNumberMatch = query.match(/\b\d{2,5}\b/);
    const targetTrainNumber = trainNumberMatch?.[0] || '';

    const targetTrainName = query
      .replace(/\(\s*\d{2,5}\s*\)/g, '')
      .replace(/\b\d{2,5}\b/g, '')
      .replace(/\bexpress\b/gi, '')
      .replace(/[-()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    console.log('[Railway] Target train:', {
      original: targetTrain,
      number: targetTrainNumber,
      name: targetTrainName,
      seatClass
    });

    const trainCards = Array.from(document.querySelectorAll(
      '.single-train-details, .train-item, .train-card, .search-result-item, [class*="single-train"], [class*="train-item"]'
    )) as HTMLElement[];

    if (!trainCards.length) {
      console.warn(
        '[Railway] No train cards found using current selectors.'
      );

      console.log(
        '[Railway] All buttons:',
        Array.from(document.querySelectorAll('button')).map((el, i) => ({
          index: i,
          text: el.textContent?.trim(),
          className: el.className,
          ariaLabel: el.getAttribute('aria-label')
        }))
      );

      console.log(
        '[Railway] All links:',
        Array.from(document.querySelectorAll('a')).map((el, i) => ({
          index: i,
          text: el.textContent?.trim(),
          href: el.getAttribute('href'),
          className: el.className
        }))
      );

      return false;
    }

    let matchedCard: HTMLElement | null = null;

    for (const card of trainCards) {
      const cardText = (card.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      const numberMatches =
        !!targetTrainNumber &&
        cardText.includes(targetTrainNumber);

      const nameMatches =
        !!targetTrainName &&
        targetTrainName.length >= 3 &&
        cardText.includes(targetTrainName);

      // If both number and name are supplied, prefer a card
      // containing both.
      if (
        targetTrainNumber &&
        targetTrainName &&
        numberMatches &&
        nameMatches
      ) {
        matchedCard = card;
        break;
      }

      // Number-only search
      if (targetTrainNumber && numberMatches) {
        matchedCard = card;
        break;
      }

      // Name-only search
      if (!targetTrainNumber && nameMatches) {
        matchedCard = card;
        break;
      }
    }

    if (!matchedCard) {
      console.warn(
        `[Railway] Target train not found: ${targetTrain}`
      );

      return false;
    }

    console.log('[Railway] Target train card found:', matchedCard);

    try {
      matchedCard.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    } catch {
      matchedCard.scrollIntoView();
    }

    this.debugTrainCard(matchedCard);

    const classVariations = this.getClassVariations(seatClass);

    /*
     * Find the smallest DOM container that contains the requested
     * seat class. This is important because searching the entire
     * train card can accidentally select another class.
     */
    const elements = Array.from(
      matchedCard.querySelectorAll('*')
    ) as HTMLElement[];

    let classContainer: HTMLElement | null = null;

    for (const el of elements) {
      const text = (el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

      if (!text || text.length > 300) {
        continue;
      }

      const matchesClass = classVariations.some(v =>
        text === v ||
        text.includes(v)
      );

      if (!matchesClass) {
        continue;
      }

      const bookingCandidates = el.querySelectorAll(
        'button, a, input[type="button"], input[type="submit"], [role="button"]'
      );

      if (bookingCandidates.length > 0) {
        classContainer = el;
        break;
      }
    }

    let targetBookBtn: HTMLElement | null = null;

    /*
     * First priority:
     * Book button inside requested class container.
     */
    if (classContainer) {
      const candidates = Array.from(
        classContainer.querySelectorAll(
          'button, a, input[type="button"], input[type="submit"], [role="button"]'
        )
      ) as HTMLElement[];

      for (const candidate of candidates) {
        if (
          this.isBookingIntentElement(candidate) &&
          this.isValidBookingHref(candidate)
        ) {
          targetBookBtn = candidate;
          break;
        }
      }
    }

    /*
     * Second priority:
     * Find a class-specific row/container directly.
     */
    if (!targetBookBtn) {
      const containers = Array.from(
        matchedCard.querySelectorAll(
          'div, section, article, li, td, tr'
        )
      ) as HTMLElement[];

      for (const container of containers) {
        const text = (container.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .toUpperCase();

        if (!classVariations.some(v => text.includes(v))) {
          continue;
        }

        const candidates = Array.from(
          container.querySelectorAll(
            'button, a, input[type="button"], input[type="submit"], [role="button"]'
          )
        ) as HTMLElement[];

        for (const candidate of candidates) {
          if (
            this.isBookingIntentElement(candidate) &&
            this.isValidBookingHref(candidate)
          ) {
            targetBookBtn = candidate;
            break;
          }
        }

        if (targetBookBtn) {
          break;
        }
      }
    }

    if (!targetBookBtn) {
      console.warn(
        `[Railway] Could not find Book button for ${seatClass} in ${targetTrain}`
      );

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
      targetBookBtn.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    } catch {
      targetBookBtn.scrollIntoView();
    }

    await new Promise(resolve =>
      setTimeout(resolve, Math.min(baseDelayMs, 300))
    );

    if (signal?.aborted) {
      throw new Error('Automation aborted by user');
    }

    targetBookBtn.focus();

    targetBookBtn.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window
      })
    );

    targetBookBtn.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        view: window
      })
    );

    targetBookBtn.click();

    console.log(
      `[Railway] Book clicked for ${targetTrain} / ${seatClass}`
    );

    return true;
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

  /**
   * Find "Select Coach" dropdown on seat map view and automatically select a coach with available seats
   */
  public static selectBestCoachFromDropdown(
    requiredSeats: number = 1
  ): boolean {
    const selects = Array.from(
      document.querySelectorAll('select')
    );

    let coachSelectEl: HTMLSelectElement | null = null;

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

      if (looksLikeCoach) {
        coachSelectEl = sel;
        break;
      }
    }

    if (!coachSelectEl) {
      console.warn('[Railway] Coach dropdown not found.');
      return false;
    }

    const options = Array.from(coachSelectEl.options);

    let bestOption: HTMLOptionElement | null = null;
    let bestAvailable = -1;

    for (const option of options) {
      const text = (
        option.text ||
        option.value ||
        ''
      ).trim().toUpperCase();

      if (!text) continue;

      if (
        text.includes('SELECT') ||
        text.includes('CHOOSE') ||
        text.includes('OPTION')
      ) {
        continue;
      }

      /*
       * Examples:
       *
       * GA (20 Available)
       * GA - 20 Seat(s)
       * GA - 20 Seats
       * GA (20)
       */
      const matches = [
        text.match(/(\d+)\s*AVAILABLE/i),
        text.match(/(\d+)\s*SEAT/i),
        text.match(/\(\s*(\d+)\s*\)/),
        text.match(/[-:]\s*(\d+)/)
      ];

      let available = 0;

      for (const match of matches) {
        if (match) {
          available = parseInt(match[1], 10);
          break;
        }
      }

      if (available <= 0) {
        continue;
      }

      console.log(
        `[Railway] Coach ${text}: ${available} available`
      );

      /*
       * We want a coach that can satisfy the requested
       * number of seats.
       */
      if (
        available >= requiredSeats &&
        available > bestAvailable
      ) {
        bestOption = option;
        bestAvailable = available;
      }
    }

    if (!bestOption) {
      console.warn(
        `[Railway] No coach has ${requiredSeats} available seat(s).`
      );

      return false;
    }

    console.log(
      `[Railway] Selecting coach "${bestOption.text}" with ${bestAvailable} available seat(s).`
    );

    if (coachSelectEl.value !== bestOption.value) {
      coachSelectEl.focus();

      this.setSelectValue(
        coachSelectEl,
        bestOption.value
      );
    }

    return true;
  }
}
