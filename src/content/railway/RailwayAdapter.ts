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
   * Set journey date supporting React DatePickers, direct text inputs, and calendar overlays
   */
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
   * Direct navigation to search results URL if standard form submit is blocked or reloads home
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
    const formatYYYYMMDD = `${yearStr}-${monthStr}-${dayStr}`;    // 2026-09-30
    const formatDDMMYYYY = `${dayStr}/${monthStr}/${yearStr}`;    // 30/09/2026

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
   * Find target train card on search results page and click class / Book Now button
   */
  public static async findAndSelectTargetTrain(
    targetTrain: string,
    seatClass: string,
    baseDelayMs: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    const query = targetTrain.toLowerCase().trim();
    const trainNumMatch = query.match(/\d+/);
    const trainNumber = trainNumMatch ? trainNumMatch[0] : ''; // e.g. "773" for KALNI EXPRESS (773)
    const cleanName = query.replace(/\(\d+\)/, '').replace(/express/g, '').trim(); // e.g. "kalni"

    // 1. Search headings and train title elements specifically
    const candidateTitles = Array.from(document.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, .train-name, [class*="train-name"], [class*="trainTitle"], [class*="train-title"], [class*="TrainName"]'
    ));

    let matchedTitleEl: HTMLElement | null = null;

    for (const titleEl of candidateTitles) {
      const text = (titleEl.textContent || '').toLowerCase();
      if (trainNumber && text.includes(trainNumber)) {
        matchedTitleEl = titleEl as HTMLElement;
        break;
      }
      if (cleanName && cleanName.length >= 3 && text.includes(cleanName)) {
        matchedTitleEl = titleEl as HTMLElement;
        break;
      }
    }

    // 2. Fallback search across all text nodes if heading tag wasn't used
    if (!matchedTitleEl) {
      const allDivs = Array.from(document.querySelectorAll('div, section, article, p, span, strong, b'));
      for (const el of allDivs) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (text.length > 0 && text.length <= 100) {
          if (trainNumber && text.includes(trainNumber)) {
            matchedTitleEl = el as HTMLElement;
            break;
          }
          if (cleanName && cleanName.length >= 3 && text.includes(cleanName)) {
            matchedTitleEl = el as HTMLElement;
            break;
          }
        }
      }
    }

    if (!matchedTitleEl) return false;

    // 3. Walk up the DOM tree to find the immediate single train card container
    let matchedCard: HTMLElement | null = matchedTitleEl.closest(
      '.single-train-details, .train-item, .train-card, .search-result-item, [class*="single-train"], [class*="train-item"]'
    ) as HTMLElement;

    if (!matchedCard) {
      let parent: HTMLElement | null = matchedTitleEl.parentElement;
      while (parent && parent !== document.body) {
        if (parent.querySelector('button, a')) {
          matchedCard = parent;
          break;
        }
        parent = parent.parentElement;
      }
    }

    if (!matchedCard) return false;

    // Auto-scroll page so target train card (e.g. KALNI EXPRESS 773) is centered on screen
    try {
      matchedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      matchedCard.scrollIntoView();
    }

    // 4. Search for class sub-blocks & BOOK NOW button inside the target train card
    const variations = this.getClassVariations(seatClass);
    const allButtons = Array.from(matchedCard.querySelectorAll('button, a, input[type="button"], input[type="submit"], .btn-book-now, [class*="book"]'));
    const bookButtons = allButtons.filter(btn => {
      const text = (btn.textContent || (btn as HTMLInputElement).value || '').toUpperCase();
      return text.includes('BOOK') || text.includes('SELECT') || text.includes('PURCHASE');
    });

    let targetBookBtn: HTMLElement | null = null;

    // A. Check if any BOOK NOW button belongs to a parent container matching requested seatClass (e.g. SNIGDHA, AC_S, S_CHAIR)
    for (const btn of bookButtons) {
      let parent: HTMLElement | null = btn.parentElement;
      let depth = 0;
      while (parent && parent !== matchedCard && depth < 5) {
        const text = (parent.textContent || '').toUpperCase();
        if (variations.some(varStr => text.includes(varStr))) {
          targetBookBtn = btn as HTMLElement;
          break;
        }
        parent = parent.parentElement;
        depth++;
      }
      if (targetBookBtn) break;
    }

    // B. Fallback: If requested class is 0 / sold out (no BOOK NOW button), click first available BOOK NOW button in target train card
    if (!targetBookBtn && bookButtons.length > 0) {
      targetBookBtn = bookButtons[0] as HTMLElement;
    }

    if (!targetBookBtn && allButtons.length > 0) {
      targetBookBtn = allButtons[0] as HTMLElement;
    }

    if (targetBookBtn) {
      try {
        targetBookBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        targetBookBtn.scrollIntoView();
      }
      targetBookBtn.focus();
      targetBookBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      targetBookBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      targetBookBtn.click();
      return true;
    }

    return false;
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
  public static selectBestCoachFromDropdown(requiredSeats: number = 1): boolean {
    const selects = Array.from(document.querySelectorAll('select'));
    let coachSelectEl: HTMLSelectElement | null = null;

    // Find select element containing coach options like "GA ( 20 Available )", "KA - 1 Seat(s)", "KHA - 0 Seat(s)"
    for (const sel of selects) {
      const nameOrId = (sel.name || sel.id || sel.getAttribute('aria-label') || '').toLowerCase();
      const optionTexts = Array.from(sel.options).map(o => (o.text || o.value).toUpperCase());
      
      if (nameOrId.includes('coach') || nameOrId.includes('bogey') ||
          optionTexts.some(txt => txt.includes('SEAT') || txt.includes('COACH') || txt.includes('AVAILABLE') || txt.includes('CHOICE') || txt.includes('SELECT'))) {
        coachSelectEl = sel;
        break;
      }
    }

    if (!coachSelectEl) {
      coachSelectEl = this.findElementByText('select', 'coach') as HTMLSelectElement;
    }

    if (!coachSelectEl) return false;

    const options = Array.from(coachSelectEl.options);
    if (options.length <= 1 && options[0]?.value === '') {
      return false; // Options not loaded into DOM yet
    }

    let targetOpt: HTMLOptionElement | null = null;
    let maxAvailable = -1;

    for (const opt of options) {
      const text = (opt.text || opt.value).toUpperCase();
      if (text.includes('SELECT') || text.includes('CHOOSE') || text.includes('OPTION') || opt.value === '') {
        continue;
      }

      // Extract seat count from text formats: "20 AVAILABLE", "20 SEATS", "(20)", "- 20"
      const countMatch = text.match(/(\d+)\s*(?:SEAT|AVAILABLE|TICKET|\))/i) ||
                         text.match(/\(\s*(\d+)\s*\)/) ||
                         text.match(/[\-\:]\s*(\d+)/);

      let availableCount = 0;
      if (countMatch) {
        availableCount = parseInt(countMatch[1], 10);
      } else if (!text.includes('0 ') && !text.includes('NONE') && !text.includes('FULL') && !text.includes('UNAVAILABLE')) {
        availableCount = 1;
      }

      if (availableCount >= requiredSeats && availableCount > maxAvailable) {
        maxAvailable = availableCount;
        targetOpt = opt;
      } else if (availableCount > 0 && maxAvailable < requiredSeats && availableCount > maxAvailable) {
        maxAvailable = availableCount;
        targetOpt = opt;
      }
    }

    // Fallback: Pick any non-placeholder option
    if (!targetOpt) {
      targetOpt = options.find(opt => {
        const text = (opt.text || opt.value).toUpperCase();
        return opt.value !== '' && !text.includes('SELECT') && !text.includes('CHOOSE') && !text.includes('0 AVAIL') && !text.includes('0 SEAT');
      }) || null;
    }

    if (targetOpt && coachSelectEl.value !== targetOpt.value) {
      coachSelectEl.focus();
      this.setSelectValue(coachSelectEl, targetOpt.value);
      return true;
    }

    return targetOpt !== null && coachSelectEl.value === targetOpt.value;
  }
}

