import { BookingSettings, AutomationState, LogItem } from '../shared/types';
import { RailwayAdapter } from '../content/railway/RailwayAdapter';
import { SeatMapParser } from './seat/SeatMapParser';
import { SeatSelectionEngine } from './seat/SeatSelectionEngine';
import { CoachSeatMap } from './seat/SeatTypes';

export class AutomationEngine {
  private abortController: AbortController | null = null;
  private settings: BookingSettings;
  private onStateChange: (state: AutomationState, statusText?: string) => void;
  private onLog: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;

  constructor(
    settings: BookingSettings,
    onStateChange: (state: AutomationState, statusText?: string) => void,
    onLog: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void
  ) {
    this.settings = settings;
    this.onStateChange = onStateChange;
    this.onLog = onLog;
  }

  /**
   * Detect the current page type by inspecting the live DOM and URL.
   * Always call at the point of use — never cache the result across navigations.
   */
  private detectCurrentPageType(): 'HOMEPAGE' | 'SEARCH_RESULTS' | 'SEAT_MAP' {
    const url = window.location.href.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();

    console.log('[Railway] Detecting page type:', {
      url,
      pathname
    });

    // ============================================================
    // 1. SEARCH RESULTS URL HAS HIGHEST PRIORITY
    // ============================================================
    if (
      pathname === '/booking/train/search' ||
      url.includes('/booking/train/search')
    ) {
      console.log('[Railway] Page detected: SEARCH_RESULTS (URL)');
      return 'SEARCH_RESULTS';
    }

    // ============================================================
    // 2. SEAT / BOOKING PAGE URL
    // ============================================================
    if (
      url.includes('/booking/seat') ||
      url.includes('/seat-selection') ||
      url.includes('/booking/train/booking')
    ) {
      console.log('[Railway] Page detected: SEAT_MAP (URL)');
      return 'SEAT_MAP';
    }

    // ============================================================
    // 3. SEAT MAP DOM
    // ============================================================
    const seatMapContainer = document.querySelector(
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

    const hasCoachDropdown = Array.from(
      document.querySelectorAll('select')
    ).some(sel => {
      const nameOrId = (
        sel.name ||
        sel.id ||
        sel.getAttribute('aria-label') ||
        ''
      ).toLowerCase();

      const txt = (sel.textContent || '').toUpperCase();

      return (
        nameOrId.includes('coach') ||
        nameOrId.includes('bogey') ||
        txt.includes('SEAT(S)') ||
        txt.includes('SEATS AVAILABLE') ||
        txt.includes('CHOICE COACH')
      );
    });

    if (seatMapContainer || hasCoachDropdown) {
      console.log('[Railway] Page detected: SEAT_MAP (DOM)');
      return 'SEAT_MAP';
    }

    // ============================================================
    // 4. SEARCH RESULTS DOM
    // ============================================================
    const trainCards = document.querySelectorAll(
      [
        '.train-item',
        '.train-card',
        '.single-train-details',
        '.search-result-item',
        '[class*="single-train"]',
        '[class*="train-item"]'
      ].join(',')
    );

    if (trainCards.length > 0) {
      console.log(
        `[Railway] Page detected: SEARCH_RESULTS (${trainCards.length} train card(s))`
      );

      return 'SEARCH_RESULTS';
    }

    // ============================================================
    // 5. OTHER BOOKING/TRAIN URL
    // ============================================================
    if (url.includes('/booking/train')) {
      console.log('[Railway] Page detected: SEARCH_RESULTS (booking URL)');
      return 'SEARCH_RESULTS';
    }

    // ============================================================
    // 6. HOMEPAGE
    // ============================================================
    console.log('[Railway] Page detected: HOMEPAGE');

    return 'HOMEPAGE';
  }

  /**
   * Return true if the current URL indicates the Railway homepage (not search or booking pages)
   */
  private isHomePage(): boolean {
    const url = window.location.href;
    return (
      url === 'https://eticket.railway.gov.bd/' ||
      url === 'https://eticket.railway.gov.bd' ||
      url === 'https://eticket.railway.gov.bd/#' ||
      (url.startsWith('https://eticket.railway.gov.bd') &&
        !url.includes('/booking') &&
        !url.includes('/seat') &&
        !url.includes('/train'))
    );
  }

  public async start(): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      this.onLog('Automation engine initialized', 'info');
      this.onStateChange(AutomationState.STARTING, 'Starting booking process...');

      // ── STEP 1: Safety check ──────────────────────────────────────────────
      const safetyHalt = RailwayAdapter.detectSafetyHalt();
      if (safetyHalt) {
        this.handleSafetyHalt(safetyHalt);
        return;
      }

      // ── STEP 2: Homepage form fill & search ───────────────────────────────
      const currentUrl = window.location.href.toLowerCase();

      const isSearchResultsUrl =
        currentUrl.includes('/booking/train/search');

      const isSeatMapUrl =
        currentUrl.includes('/booking/seat') ||
        currentUrl.includes('/seat-selection');

      const isRailwayHomepage =
        !isSearchResultsUrl &&
        !isSeatMapUrl &&
        (
          currentUrl === 'https://eticket.railway.gov.bd/' ||
          currentUrl === 'https://eticket.railway.gov.bd' ||
          currentUrl === 'https://eticket.railway.gov.bd/#'
        );

      if (isRailwayHomepage) {
        this.checkAborted(signal);
        this.onStateChange(AutomationState.SELECTING_ROUTE, `Setting route ${this.settings.fromStation} → ${this.settings.toStation}`);

        this.onLog(`Selecting origin: ${this.settings.fromStation}`, 'info');
        await RailwayAdapter.selectStation('from', this.settings.fromStation, this.settings.actionDelay, signal);

        this.checkAborted(signal);
        this.onLog(`Selecting destination: ${this.settings.toStation}`, 'info');
        await RailwayAdapter.selectStation('to', this.settings.toStation, this.settings.actionDelay, signal);

        this.checkAborted(signal);
        this.onStateChange(AutomationState.SELECTING_DATE, `Setting journey date: ${this.settings.journeyDate}`);
        this.onLog(`Setting journey date: ${this.settings.journeyDate}`, 'info');
        await RailwayAdapter.selectJourneyDate(this.settings.journeyDate, this.settings.actionDelay, signal);

        this.checkAborted(signal);
        if (this.settings.seatClass) {
          this.onLog(`Selecting seat class: ${this.settings.seatClass}`, 'info');
          await this.delay(150, signal);
          await RailwayAdapter.selectClass(this.settings.seatClass, this.settings.actionDelay, signal);
        }

        this.checkAborted(signal);
        this.onStateChange(AutomationState.SEARCHING, 'Submitting train search query...');

        this.onLog('Clicking Search Train button...', 'info');

        const searchBtn = RailwayAdapter.findElement([
          'button[type="submit"]',
          '.search-btn',
          '.btn-booking-search',
          'button.search-train-btn'
        ]) || RailwayAdapter.findElementByText('button', 'search');

        if (searchBtn) {
          searchBtn.focus();
          searchBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          searchBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          searchBtn.click();
        }

        // ── Wait up to 4.5s for the SPA to navigate to search results organically ──
        let searchNavigatedOrRendered = false;
        for (let i = 0; i < 15; i++) {
          this.checkAborted(signal);
          await this.delay(300, signal);
          const hasCards = document.querySelectorAll(
            '.train-item, .train-card, .single-train-details, .search-result-item, [class*="single-train"]'
          ).length > 0;
          if (window.location.href.includes('/booking/train/search') || hasCards) {
            searchNavigatedOrRendered = true;
            this.onLog('SPA search submission completed naturally.', 'info');
            break;
          }
        }

        // ── Fallback: direct URL navigation only if SPA did NOT respond ──
        if (!searchNavigatedOrRendered) {
          this.onLog(
            `SPA search form did not respond after 4.5s. Navigating via URL as last resort: ${this.settings.fromStation} → ${this.settings.toStation} (${this.settings.journeyDate})`,
            'warning'
          );
          RailwayAdapter.navigateToSearchResults(
            this.settings.fromStation,
            this.settings.toStation,
            this.settings.journeyDate,
            this.settings.seatClass
          );
          // After a hard navigation, the page will reload — the content script will re-run automatically.
          return;
        }
      }

      // ── STEP 3: Wait for search results / target train ─────────────

      this.onLog(
        'Search results URL reached. Waiting for train results to render...',
        'info'
      );

      let resultsReady = false;

      const targetText = this.settings.targetTrain
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

      const trainNumberMatch = targetText.match(/\b\d{2,5}\b/);
      const targetTrainNumber = trainNumberMatch?.[0] || '';

      const targetTrainName = targetText
        .replace(/\(\s*\d{2,5}\s*\)/g, '')
        .replace(/\b\d{2,5}\b/g, '')
        .replace(/\bexpress\b/gi, '')
        .replace(/[-()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      for (let attempt = 0; attempt < 40; attempt++) {
        this.checkAborted(signal);

        const currentUrl = window.location.href.toLowerCase();
        const pageType = this.detectCurrentPageType();

        const bodyText = (document.body.innerText || '')
          .toLowerCase()
          .replace(/\s+/g, ' ');

        const trainCards = document.querySelectorAll(
          [
            '.train-item',
            '.train-card',
            '.single-train-details',
            '.search-result-item',
            '[class*="single-train"]',
            '[class*="train-item"]'
          ].join(',')
        );

        const foundByNumber =
          !!targetTrainNumber &&
          bodyText.includes(targetTrainNumber);

        const foundByName =
          !!targetTrainName &&
          targetTrainName.length >= 3 &&
          bodyText.includes(targetTrainName);

        this.onLog(
          `Search results check ${attempt + 1}/40 | Page=${pageType} | Cards=${trainCards.length} | Target=${this.settings.targetTrain}`,
          'info'
        );

        if (
          currentUrl.includes('/booking/train/search') &&
          (foundByNumber || foundByName)
        ) {
          resultsReady = true;

          this.onLog(
            `Target train '${this.settings.targetTrain}' detected in search results.`,
            'success'
          );

          break;
        }

        await this.delay(500, signal);
      }

      if (!resultsReady) {
        this.onLog(
          `Search page loaded, but target train '${this.settings.targetTrain}' was not found.`,
          'error'
        );

        this.onStateChange(
          AutomationState.ERROR,
          `Target train '${this.settings.targetTrain}' was not found.`
        );

        return;
      }

      // ── STEP 4: Find target train & click Book button ─────────────────────
      // Re-check page type — do NOT use a stale variable from before navigation.
      const currentPageType = this.detectCurrentPageType();
      if (currentPageType === 'SEARCH_RESULTS' || currentPageType === 'HOMEPAGE') {
        this.checkAborted(signal);
        this.onStateChange(AutomationState.SEARCH_RESULTS, 'Locating target train on search results...');

        let trainBookingOpened = false;

        for (let attempt = 0; attempt < 5; attempt++) {
          this.checkAborted(signal);

          this.onLog(
            `Looking for target train '${this.settings.targetTrain}' — Seat class: ${this.settings.seatClass} (attempt ${attempt + 1}/5)...`,
            'info'
          );

          const beforeUrl = window.location.href;

          // findAndSelectTargetTrain returns true only if it clicked an element with booking intent.
          const clicked = await RailwayAdapter.findAndSelectTargetTrain(
            this.settings.targetTrain,
            this.settings.seatClass,
            this.settings.actionDelay,
            signal
          );

          if (!clicked) {
            this.onLog(`Train card or booking button not yet visible (attempt ${attempt + 1}/5). Waiting...`, 'info');
            await this.delay(600, signal);
            continue;
          }

          this.onLog('Booking button clicked. Waiting for Railway to navigate to booking / seat map page...', 'info');

          // ── Verify post-click navigation ──────────────────────────────────
          // Poll up to 6 seconds (20 × 300ms) after the click.
          for (let wait = 0; wait < 20; wait++) {
            this.checkAborted(signal);
            await this.delay(300, signal);

            const currentUrl = window.location.href;
            const livePage = this.detectCurrentPageType();

            this.onLog(`Post-click check ${wait + 1}/20 — Page: ${livePage} | URL: ${currentUrl}`, 'info');

            // ✅ Success: seat map or booking page appeared
            if (livePage === 'SEAT_MAP' || currentUrl.includes('/booking/seat') || currentUrl.includes('/seat-selection')) {
              trainBookingOpened = true;
              this.onLog(`Target train '${this.settings.targetTrain}' booking page opened successfully!`, 'success');
              break;
            }

            // ✅ Also accept: still on /booking/train/... but DOM changed (card-selection modal appeared)
            if (currentUrl.includes('/booking/train') && livePage !== 'SEARCH_RESULTS') {
              trainBookingOpened = true;
              this.onLog(`Booking action registered. Continuing to seat map detection...`, 'success');
              break;
            }

            // 🚨 CRITICAL FAIL: Railway redirected to homepage
            if (this.isHomePage() && currentUrl !== beforeUrl) {
              this.onLog(
                `🚨 Railway redirected to the homepage after clicking Book. The clicked element was NOT accepted as a booking action by the Railway application. Check console diagnostics for clicked element details.`,
                'error'
              );
              this.onStateChange(
                AutomationState.ERROR,
                'Railway returned to homepage after Book click. Check extension diagnostics in browser console.'
              );
              return; // Hard stop — do NOT retry this cycle
            }
          }

          if (trainBookingOpened) break;

          this.onLog(`Book click did not open booking/seat map page after 6s (attempt ${attempt + 1}/5).`, 'warning');
        }

        if (!trainBookingOpened) {
          this.onStateChange(
            AutomationState.ERROR,
            `Could not open booking page for '${this.settings.targetTrain}'. Please click Book Now manually.`
          );
          this.onLog(`Could not open booking page for '${this.settings.targetTrain}' after 5 attempts.`, 'error');
          return;
        }

        // Safety halt check after train selection
        const postSelectHalt = RailwayAdapter.detectSafetyHalt();
        if (postSelectHalt) {
          this.handleSafetyHalt(postSelectHalt);
          return;
        }
      }

      // ── STEP 5: Seat Map Detection & Selection ────────────────────────────

      this.checkAborted(signal);

      this.onStateChange(
        AutomationState.WAITING_FOR_SEAT_MAP,
        `Waiting for ${this.settings.seatClass} seat map...`
      );

      let coachMaps: CoachSeatMap[] = [];

      const maxSeatMapAttempts = 40;

      for (let attempt = 0; attempt < maxSeatMapAttempts; attempt++) {
        this.checkAborted(signal);

        if (this.isHomePage()) {
          this.onLog(
            'Page returned to homepage while waiting for seat map. Aborting.',
            'error'
          );

          this.onStateChange(
            AutomationState.ERROR,
            'Railway returned to homepage unexpectedly.'
          );

          return;
        }

        /*
         * Select a coach that has enough seats for the requested
         * seat count.
         */
        const coachSelected =
          RailwayAdapter.selectBestCoachFromDropdown(
            this.settings.seatCount
          );

        if (coachSelected) {
          this.onLog(
            `Coach selected for ${this.settings.seatCount} requested seat(s).`,
            'info'
          );

          await this.delay(500, signal);
        }

        /*
         * If Railway uses coach tabs instead of dropdown.
         */
        RailwayAdapter.clickAvailableCoachTab();

        await this.delay(200, signal);

        /*
         * Parse current seat map.
         */
        coachMaps =
          SeatMapParser.parseFromDOM(document);

        const availableSeatsCount =
          coachMaps.reduce(
            (total, coach) =>
              total +
              coach.seats.filter(
                seat => seat.isAvailable
              ).length,
            0
          );

        this.onLog(
          `Seat-map attempt ${attempt + 1}/${maxSeatMapAttempts}: ${availableSeatsCount} available seat(s), ${this.settings.seatCount} required.`,
          'info'
        );

        if (
          availableSeatsCount >=
          this.settings.seatCount
        ) {
          this.onLog(
            `Enough seats found: ${availableSeatsCount}/${this.settings.seatCount}.`,
            'success'
          );

          break;
        }

        if (availableSeatsCount > 0) {
          this.onLog(
            `Only ${availableSeatsCount} seat(s) available; ${this.settings.seatCount} required. Waiting for a suitable coach/seat layout...`,
            'warning'
          );
        }

        await this.delay(350, signal);
      }


      // ── STEP 6: Seat Selection ───────────────────────────────

      if (coachMaps.length === 0) {
        this.onLog(
          `No seat map detected for ${this.settings.targetTrain} / ${this.settings.seatClass}.`,
          'error'
        );

        this.onStateChange(
          AutomationState.ERROR,
          'Seat map was not loaded.'
        );

        return;
      }

      this.onStateChange(
        AutomationState.ANALYZING_SEATS,
        `Selecting ${this.settings.seatCount} ${this.settings.seatClass} seat(s)...`
      );

      const totalAvailable =
        coachMaps.reduce(
          (total, coach) =>
            total +
            coach.seats.filter(
              seat => seat.isAvailable
            ).length,
          0
        );

      if (totalAvailable < this.settings.seatCount) {
        this.onLog(
          `Only ${totalAvailable} seat(s) available but ${this.settings.seatCount} requested.`,
          'error'
        );

        this.onStateChange(
          AutomationState.ERROR,
          `Not enough ${this.settings.seatClass} seats available.`
        );

        return;
      }

      const selectionResult =
        SeatSelectionEngine.selectSeats(
          coachMaps,
          this.settings.seatCount,
          this.settings.seatMode,
          this.settings.allowFallback
        );

      if (!selectionResult.success) {
        this.onLog(
          `Seat selection failed: ${selectionResult.reason}`,
          'error'
        );

        this.onStateChange(
          AutomationState.ERROR,
          selectionResult.reason
        );

        return;
      }

      /*
       * Never continue with a partial selection.
       */
      if (
        selectionResult.seats.length !==
        this.settings.seatCount
      ) {
        const selectedCount = selectionResult.seats?.length || 0;

        this.onLog(
          `Seat selection failed. Requested ${this.settings.seatCount}, but only ${selectedCount} seat(s) could be selected. No checkout action will be performed.`,
          'error'
        );

        this.onStateChange(
          AutomationState.ERROR,
          `Could not select exactly ${this.settings.seatCount} seat(s).`
        );

        return;
      }

      this.onLog(
        `Selecting exactly ${selectionResult.seats.length} seat(s): ${selectionResult.seats
          .map(s => s.name)
          .join(', ')}`,
        'success'
      );


      /*
       * Click selected seats.
       */
      for (const seat of selectionResult.seats) {
        this.checkAborted(signal);

        if (seat.rawElement) {
          (seat.rawElement as HTMLElement).click();

          await this.delay(100, signal);
        }
      }

      await this.delay(
        this.settings.actionDelay,
        signal
      );


      /*
       * Continue only after exactly the requested number
       * of seats has been selected.
       */
      const continueBtn =
        RailwayAdapter.findElement([
          '.btn-continue',
          'button.continue-btn',
          '.proceed-btn',
          'button[type="submit"].btn-success',
          '.purchase-btn',
          '[class*="continue"]',
          '[class*="purchase"]'
        ]) ||
        RailwayAdapter.findElementByText(
          'button',
          'continue'
        ) ||
        RailwayAdapter.findElementByText(
          'button',
          'purchase'
        ) ||
        RailwayAdapter.findElementByText(
          'button',
          'confirm'
        );

      if (!continueBtn) {
        this.onLog(
          'Continue/Purchase button not found.',
          'error'
        );

        this.onStateChange(
          AutomationState.ERROR,
          'Continue button not found.'
        );

        return;
      }

      continueBtn.click();

      this.onLog(
        `Continue clicked with ${selectionResult.seats.length} ${this.settings.seatClass} seat(s).`,
        'success'
      );

      this.onStateChange(
        AutomationState.COMPLETED,
        'Seat selection completed.'
      );

      // ── STEP 7: Final safety halt check ──────────────────────────────────
      const finalHalt = RailwayAdapter.detectSafetyHalt();
      if (finalHalt) {
        this.handleSafetyHalt(finalHalt);
        return;
      }

    } catch (err: any) {
      if (err.message === 'Automation aborted by user') {
        this.onLog('Automation cancelled by user.', 'warning');
        this.onStateChange(AutomationState.IDLE, 'Stopped by user');
      } else {
        this.onLog(`Error: ${err.message || err}`, 'error');
        this.onStateChange(AutomationState.ERROR, `Error: ${err.message || err}`);
      }
    }
  }

  public stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.onLog('Stop command issued', 'warning');
    this.onStateChange(AutomationState.IDLE, 'Automation stopped');
  }

  private handleSafetyHalt(type: 'CAPTCHA' | 'OTP' | 'PAYMENT'): void {
    if (type === 'CAPTCHA') {
      this.onStateChange(AutomationState.CAPTCHA_REQUIRED, 'CAPTCHA Detected — Please solve manually!');
      this.onLog('🛑 CAPTCHA detected. Halting automation for manual user resolution.', 'warning');
    } else if (type === 'OTP') {
      this.onStateChange(AutomationState.OTP_REQUIRED, 'OTP Required — Please complete manually!');
      this.onLog('🛑 OTP verification required. Halting automation for user input.', 'warning');
    } else if (type === 'PAYMENT') {
      this.onStateChange(AutomationState.PAYMENT_REQUIRED, 'Payment Page Reached — Please enter payment info manually!');
      this.onLog('🛑 Payment gate reached. Halting automation for secure user checkout.', 'success');
    }
  }

  private checkAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error('Automation aborted by user');
    }
  }

  private async delay(ms: number, signal: AbortSignal): Promise<void> {
    const step = 50;
    let elapsed = 0;
    while (elapsed < ms) {
      this.checkAborted(signal);
      await new Promise(r => setTimeout(r, Math.min(step, ms - elapsed)));
      elapsed += step;
    }
  }
}
