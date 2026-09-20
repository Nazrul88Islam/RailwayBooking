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

    if (baseDelayMs <= 100) {
      // Ultra Fast Instant Mode
      this.setInputValue(inputEl, text);
      inputEl.dispatchEvent(new Event('focus', { bubbles: true }));
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
    const dropdownItem = document.querySelector('.select2-results__option, .autocomplete-item, .ui-menu-item, [class*="option"], [class*="suggestion"]');
    if (dropdownItem) {
      (dropdownItem as HTMLElement).click();
    }

    return true;
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
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(selectEl, value);
    } else {
      selectEl.value = value;
    }

    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
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
      if (optionTexts.some(txt => txt === 'AC_B' || txt === 'AC_S' || txt === 'SNIGDHA' || txt === 'S_CHAIR' || txt === 'F_BERTH' || txt.includes('CHOOSE A CLASS'))) {
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

    const targetVal = className.trim().toUpperCase();
    const options = Array.from(selectEl.options);
    
    const targetOption = options.find(opt => {
      const v = (opt.value || '').trim().toUpperCase();
      const t = (opt.text || '').trim().toUpperCase();
      return v === targetVal || t === targetVal || v.includes(targetVal) || t.includes(targetVal);
    });

    if (targetOption) {
      selectEl.focus();
      
      // Mark target option as selected
      options.forEach(o => (o.selected = false));
      targetOption.selected = true;
      selectEl.selectedIndex = targetOption.index;

      this.setSelectValue(selectEl, targetOption.value || targetOption.text);

      // Dispatch full event suite
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
      selectEl.dispatchEvent(new Event('blur', { bubbles: true }));

      if (selectEl.form) {
        selectEl.form.dispatchEvent(new Event('change', { bubbles: true }));
      }

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
    const targetClassQuery = seatClass.toUpperCase().trim();
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
      while (parent && parent !== matchedCard && depth < 4) {
        const text = (parent.textContent || '').toUpperCase();
        if (text.includes(targetClassQuery)) {
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

    // Find select element containing coach options like "GA - 1 Seat(s)", "KHA - 0 Seat(s)"
    for (const sel of selects) {
      const optionTexts = Array.from(sel.options).map(o => (o.text || o.value).toUpperCase());
      if (optionTexts.some(txt => txt.includes('SEAT(S)') || txt.includes('SEAT') || txt.includes('CHOICE'))) {
        coachSelectEl = sel;
        break;
      }
    }

    if (!coachSelectEl) {
      coachSelectEl = this.findElementByText('select', 'coach') as HTMLSelectElement;
    }

    if (!coachSelectEl) return false;

    const options = Array.from(coachSelectEl.options);
    let targetOpt: HTMLOptionElement | null = null;

    // Search for coach option with enough available seats
    for (const opt of options) {
      const text = (opt.text || opt.value).toUpperCase();
      const seatMatch = text.match(/(\d+)\s*SEAT/);
      if (seatMatch) {
        const availableCount = parseInt(seatMatch[1], 10);
        if (availableCount >= requiredSeats) {
          targetOpt = opt;
          break;
        } else if (availableCount > 0 && !targetOpt) {
          targetOpt = opt;
        }
      }
    }

    if (!targetOpt) {
      targetOpt = options.find(opt => {
        const text = (opt.text || opt.value).toUpperCase();
        return !text.includes('0 SEAT') && !text.includes('SELECT') && !text.includes('CHOICE');
      }) || null;
    }

    if (targetOpt && coachSelectEl.value !== targetOpt.value) {
      coachSelectEl.focus();
      this.setSelectValue(coachSelectEl, targetOpt.value);
      return true;
    }

    return false;
  }
}
