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
   * Number of seats to book. Popup/storage values often arrive as strings ("2"), and the old
   * strict `seats.length !== settings.seatCount` check then ALWAYS failed. Always coerce.
   */
  private get seatCount(): number {
    const n = Math.floor(Number(this.settings.seatCount));
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /**
   * Detect the current page type by inspecting the live DOM and URL.
   * Always call at the point of use — never cache the result across navigations.
   */
  private detectCurrentPageType(): 'HOMEPAGE' | 'SEARCH_RESULTS' | 'SEAT_MAP' {
    const url = window.location.href.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();

    console.log('[Railway] Detecting page type:', { url, pathname });

    // 1. SEARCH RESULTS URL HAS HIGHEST PRIORITY
    if (pathname === '/booking/train/search' || url.includes('/booking/train/search')) {
      console.log('[Railway] Page detected: SEARCH_RESULTS (URL)');
      return 'SEARCH_RESULTS';
    }

    // 2. SEAT / BOOKING PAGE URL
    if (
      url.includes('/booking/seat') ||
      url.includes('/seat-selection') ||
      url.includes('/booking/train/booking')
    ) {
      console.log('[Railway] Page detected: SEAT_MAP (URL)');
      return 'SEAT_MAP';
    }

    // 3. SEAT MAP DOM
    if (RailwayAdapter.isSeatMapVisible()) {
      console.log('[Railway] Page detected: SEAT_MAP (DOM)');
      return 'SEAT_MAP';
    }

    // 4. SEARCH RESULTS DOM
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
      console.log(`[Railway] Page detected: SEARCH_RESULTS (${trainCards.length} train card(s))`);
      return 'SEARCH_RESULTS';
    }

    // 5. OTHER BOOKING/TRAIN URL
    if (url.includes('/booking/train')) {
      console.log('[Railway] Page detected: SEARCH_RESULTS (booking URL)');
      return 'SEARCH_RESULTS';
    }

    // 6. HOMEPAGE
    console.log('[Railway] Page detected: HOMEPAGE');
    return 'HOMEPAGE';
  }

  /**
   * True only for the real Railway homepage (path "/"), including URLs with ?query or #hash.
   * (The old exact-string comparison missed e.g. "/?lang=en", so the form was never filled.)
   */
  private isHomePage(): boolean {
    const { hostname, pathname } = window.location;
    return hostname.endsWith('railway.gov.bd') && (pathname === '/' || pathname === '');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN FLOW
  // ══════════════════════════════════════════════════════════════════════════

  public async start(): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      this.onLog('Automation engine initialized', 'info');
      this.onStateChange(AutomationState.STARTING, 'Starting booking process...');

      if (!this.settings.targetTrain || !this.settings.targetTrain.trim()) {
        this.onLog('No target train configured.', 'error');
        this.onStateChange(AutomationState.ERROR, 'Please enter a target train name or number.');
        return;
      }

      // ── STEP 1: Safety check ──────────────────────────────────────────────
      const safetyHalt = RailwayAdapter.detectSafetyHalt();
      if (safetyHalt) {
        this.handleSafetyHalt(safetyHalt);
        return;
      }

      // ── STEP 2: Homepage form fill & search ───────────────────────────────
      if (this.isHomePage()) {
        const proceeded = await this.fillFormAndSearch(signal);
        if (!proceeded) return; // hard navigation triggered — page will reload
      }

      // ── STEP 3 + 4: find target train → click Book for the seat class ─────
      if (this.detectCurrentPageType() !== 'SEAT_MAP') {
        if (!(await this.waitForTargetTrain(signal))) return;
        if (!(await this.openBookingForTargetTrain(signal))) return;

        const postSelectHalt = RailwayAdapter.detectSafetyHalt();
        if (postSelectHalt) {
          this.handleSafetyHalt(postSelectHalt);
          return;
        }
      }

      // ── STEP 5: Seat map (choose coach with enough seats) ─────────────────
      const coachMaps = await this.waitForSeatMap(signal);
      if (coachMaps === null) return; // error already reported

      // ── STEP 6 + 7: pick exactly N seats, continue, final safety check ────
      await this.selectSeatsAndContinue(coachMaps, signal);
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

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — homepage form
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Fills From / To / Date / Class and submits the search.
   * Returns true when the search results are showing (SPA navigation worked),
   * false when we had to hard-navigate (page reloads and this engine instance dies).
   */
  private async fillFormAndSearch(signal: AbortSignal): Promise<boolean> {
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

    // Prefer the specific search button; a generic submit button may be Login etc.
    const searchBtn =
      RailwayAdapter.findElement(['.btn-booking-search', 'button.search-train-btn', '.search-btn']) ||
      RailwayAdapter.findElementByText('button', 'search') ||
      RailwayAdapter.findElement(['button[type="submit"]']);

    if (searchBtn) {
      searchBtn.focus();
      searchBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      searchBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      searchBtn.click();
    } else {
      this.onLog('Search button not found — will fall back to direct URL navigation.', 'warning');
    }

    // Wait up to 4.5s for the SPA to navigate to search results organically
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
      // The page reloads and THIS engine instance is destroyed. Your content script must
      // re-create the engine and call start() again after reload (persist a "running" flag),
      // otherwise the bot will appear to stop right here.
      this.onLog('Page is reloading — the content script must resume automation after reload.', 'warning');
      return false;
    }

    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — wait for the target train to show up in the results
  // ══════════════════════════════════════════════════════════════════════════

  private async waitForTargetTrain(signal: AbortSignal): Promise<boolean> {
    this.onStateChange(AutomationState.SEARCH_RESULTS, `Waiting for '${this.settings.targetTrain}' in search results...`);
    this.onLog('Waiting for train results to render...', 'info');

    const target = RailwayAdapter.parseTargetTrain(this.settings.targetTrain);
    const maxAttempts = 40;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      this.checkAborted(signal);

      const url = window.location.href.toLowerCase();
      const pageType = this.detectCurrentPageType();
      const bodyText = document.body.innerText || '';

      const cardCount = document.querySelectorAll(
        '.train-item, .train-card, .single-train-details, .search-result-item, [class*="single-train"], [class*="train-item"]'
      ).length;

      const found = RailwayAdapter.matchesTrain(bodyText, target);

      this.onLog(
        `Search results check ${attempt + 1}/${maxAttempts} | Page=${pageType} | Cards=${cardCount} | Target=${this.settings.targetTrain} | Found=${found}`,
        'info'
      );

      if (url.includes('/booking/train') && found) {
        this.onLog(`Target train '${this.settings.targetTrain}' detected in search results.`, 'success');
        return true;
      }

      await this.delay(500, signal);
    }

    const hint = RailwayAdapter.detectLoginRequired()
      ? ' (Railway seems to be asking you to log in.)'
      : ' Check the train name/number spelling and the journey date.';

    this.onLog(`Search page loaded, but target train '${this.settings.targetTrain}' was not found.${hint}`, 'error');
    this.onStateChange(AutomationState.ERROR, `Target train '${this.settings.targetTrain}' was not found.${hint}`);
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 — click Book for the requested class of the target train
  // ══════════════════════════════════════════════════════════════════════════

  private async openBookingForTargetTrain(signal: AbortSignal): Promise<boolean> {
    this.checkAborted(signal);
    this.onStateChange(AutomationState.SEARCH_RESULTS, 'Locating target train on search results...');

    const maxAttempts = 12;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      this.checkAborted(signal);

      this.onLog(
        `Looking for target train '${this.settings.targetTrain}' — Seat class: ${this.settings.seatClass} (attempt ${attempt + 1}/${maxAttempts})...`,
        'info'
      );

      const beforeUrl = window.location.href;
      const seatMapBefore = RailwayAdapter.isSeatMapVisible();

      const clicked = await RailwayAdapter.findAndSelectTargetTrain(
        this.settings.targetTrain,
        this.settings.seatClass,
        this.settings.actionDelay,
        signal
      );

      if (!clicked) {
        this.onLog(
          `Book button not clicked yet: ${RailwayAdapter.lastFailureReason || 'train card / booking button not visible'} (attempt ${attempt + 1}/${maxAttempts}).`,
          'info'
        );
        await this.delay(700, signal);
        continue;
      }

      this.onLog('Book button clicked. Waiting for Railway to open the seat selection...', 'info');

      // Poll up to 6 seconds (20 × 300ms) after the click.
      for (let wait = 0; wait < 20; wait++) {
        this.checkAborted(signal);
        await this.delay(300, signal);

        const currentUrl = window.location.href;
        const lowerUrl = currentUrl.toLowerCase();
        const livePage = this.detectCurrentPageType();

        this.onLog(`Post-click check ${wait + 1}/20 — Page: ${livePage} | URL: ${currentUrl}`, 'info');

        // 🚨 Railway redirected to the homepage
        if (this.isHomePage() && currentUrl !== beforeUrl) {
          this.onLog(
            '🚨 Railway redirected to the homepage after clicking Book. The clicked element was NOT accepted as a booking action. Check console diagnostics for clicked element details.',
            'error'
          );
          this.onStateChange(
            AutomationState.ERROR,
            'Railway returned to homepage after Book click. Check extension diagnostics in browser console.'
          );
          return false;
        }

        // ✅ Seat page URL
        if (livePage === 'SEAT_MAP' || lowerUrl.includes('/booking/seat') || lowerUrl.includes('/seat-selection')) {
          this.onLog(`Target train '${this.settings.targetTrain}' booking page opened successfully!`, 'success');
          return true;
        }

        // ✅ Seat map appeared in-place (modal / same URL) — it was NOT there before the click
        if (!seatMapBefore && RailwayAdapter.isSeatMapVisible()) {
          this.onLog('Seat map appeared on the page after Book click.', 'success');
          return true;
        }

        // ✅ URL moved to another /booking/train/... page
        if (currentUrl !== beforeUrl && lowerUrl.includes('/booking/train') && !lowerUrl.includes('/booking/train/search')) {
          this.onLog('Booking action registered. Continuing to seat map detection...', 'success');
          return true;
        }

        // 🔒 Login wall (give it a moment first)
        if (wait >= 4 && RailwayAdapter.detectLoginRequired()) {
          this.onLog('Railway is asking you to log in. Log in manually, then press Start again.', 'error');
          this.onStateChange(AutomationState.ERROR, 'Login required — log in to Railway, then start again.');
          return false;
        }
      }

      this.onLog(`Book click did not open the seat map after 6s (attempt ${attempt + 1}/${maxAttempts}).`, 'warning');
    }

    this.onStateChange(
      AutomationState.ERROR,
      `Could not open booking page for '${this.settings.targetTrain}' (${this.settings.seatClass}). Please click Book Now manually.`
    );
    this.onLog(
      `Could not open booking page for '${this.settings.targetTrain}' / ${this.settings.seatClass} after ${maxAttempts} attempts. Last reason: ${RailwayAdapter.lastFailureReason || 'n/a'}`,
      'error'
    );
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5 — seat map
  // ══════════════════════════════════════════════════════════════════════════

  private countAvailable(maps: CoachSeatMap[]): number {
    return maps.reduce(
      (total, coach) => total + coach.seats.filter(seat => seat.isAvailable).length,
      0
    );
  }

  /** Returns the parsed coach maps, or null if an error was already reported. */
  private async waitForSeatMap(signal: AbortSignal): Promise<CoachSeatMap[] | null> {
    this.checkAborted(signal);

    const need = this.seatCount;

    this.onStateChange(
      AutomationState.WAITING_FOR_SEAT_MAP,
      `Waiting for ${this.settings.seatClass} seat map...`
    );

    let coachMaps: CoachSeatMap[] = [];
    const maxSeatMapAttempts = 40;

    for (let attempt = 0; attempt < maxSeatMapAttempts; attempt++) {
      this.checkAborted(signal);

      if (this.isHomePage()) {
        this.onLog('Page returned to homepage while waiting for seat map. Aborting.', 'error');
        this.onStateChange(AutomationState.ERROR, 'Railway returned to homepage unexpectedly.');
        return null;
      }

      // Pick a coach that has enough seats for the requested seat count.
      const coachSelected = RailwayAdapter.selectBestCoachFromDropdown(need);
      if (coachSelected) {
        this.onLog(`Coach selected for ${need} requested seat(s).`, 'info');
        await this.delay(500, signal);
      }

      coachMaps = SeatMapParser.parseFromDOM(document);
      const availableSeatsCount = this.countAvailable(coachMaps);

      this.onLog(
        `Seat-map attempt ${attempt + 1}/${maxSeatMapAttempts}: ${availableSeatsCount} available seat(s), ${need} required.`,
        'info'
      );

      if (availableSeatsCount >= need) {
        this.onLog(`Enough seats found: ${availableSeatsCount}/${need}.`, 'success');
        break;
      }

      if (availableSeatsCount > 0) {
        this.onLog(
          `Only ${availableSeatsCount} seat(s) available; ${need} required. Waiting for a suitable coach/seat layout...`,
          'warning'
        );
      }

      // Coach TABS (no dropdown): only cycle to another coach while we still lack seats.
      // (Old code clicked a tab on every iteration, even after finding enough seats.)
      if (!RailwayAdapter.hasCoachDropdown() && RailwayAdapter.clickAvailableCoachTab()) {
        await this.delay(400, signal);
      }

      await this.delay(350, signal);
    }

    return coachMaps;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6 / 7 — pick exactly N seats and continue
  // ══════════════════════════════════════════════════════════════════════════

  private async selectSeatsAndContinue(coachMaps: CoachSeatMap[], signal: AbortSignal): Promise<void> {
    const need = this.seatCount;

    if (coachMaps.length === 0) {
      this.onLog(`No seat map detected for ${this.settings.targetTrain} / ${this.settings.seatClass}.`, 'error');
      this.onStateChange(AutomationState.ERROR, 'Seat map was not loaded.');
      return;
    }

    this.onStateChange(
      AutomationState.ANALYZING_SEATS,
      `Selecting ${need} ${this.settings.seatClass} seat(s)...`
    );

    const totalAvailable = this.countAvailable(coachMaps);

    if (totalAvailable < need) {
      this.onLog(`Only ${totalAvailable} seat(s) available but ${need} requested.`, 'error');
      this.onStateChange(AutomationState.ERROR, `Not enough ${this.settings.seatClass} seats available.`);
      return;
    }

    const selectionResult = SeatSelectionEngine.selectSeats(
      coachMaps,
      need,
      this.settings.seatMode,
      this.settings.allowFallback
    );

    if (!selectionResult.success) {
      this.onLog(`Seat selection failed: ${selectionResult.reason}`, 'error');
      this.onStateChange(AutomationState.ERROR, selectionResult.reason);
      return;
    }

    // Never continue with a partial selection.
    const selectedCount = selectionResult.seats?.length || 0;
    if (selectedCount !== need) {
      this.onLog(
        `Seat selection failed. Requested ${need}, but only ${selectedCount} seat(s) could be selected. No checkout action will be performed.`,
        'error'
      );
      this.onStateChange(AutomationState.ERROR, `Could not select exactly ${need} seat(s).`);
      return;
    }

    this.onLog(
      `Selecting exactly ${selectedCount} seat(s): ${selectionResult.seats.map(s => s.name).join(', ')}`,
      'success'
    );

    // Click selected seats.
    for (const seat of selectionResult.seats) {
      this.checkAborted(signal);

      const el = seat.rawElement as HTMLElement | null | undefined;
      if (!el) continue;

      const classBefore = (el.getAttribute('class') || '');
      el.click();
      await this.delay(150, signal);

      if ((el.getAttribute('class') || '') === classBefore) {
        // Informational only — we deliberately do NOT re-click (a 2nd click could deselect it).
        this.onLog(`Seat ${seat.name}: no visible change after click (may be normal for this layout).`, 'warning');
      }
    }

    await this.delay(this.settings.actionDelay, signal);

    // Wait (up to 5s) for the Continue button to exist AND be enabled.
    let continueBtn: HTMLElement | null = null;
    for (let i = 0; i < 20; i++) {
      this.checkAborted(signal);
      continueBtn = RailwayAdapter.findContinueButton();
      if (continueBtn) break;
      await this.delay(250, signal);
    }

    if (!continueBtn) {
      this.onLog('Continue/Purchase button not found (or still disabled).', 'error');
      this.onStateChange(AutomationState.ERROR, 'Continue button not found.');
      return;
    }

    continueBtn.click();

    this.onLog(`Continue clicked with ${selectedCount} ${this.settings.seatClass} seat(s).`, 'success');

    // ── Final safety halt check (CAPTCHA / OTP / payment) ────────────────
    // Give the next screen up to ~4s to show a halt condition BEFORE declaring completion.
    for (let i = 0; i < 8; i++) {
      this.checkAborted(signal);
      await this.delay(500, signal);

      const finalHalt = RailwayAdapter.detectSafetyHalt();
      if (finalHalt) {
        this.handleSafetyHalt(finalHalt);
        return;
      }

      if (RailwayAdapter.detectLoginRequired()) {
        this.onLog('Railway is asking you to log in. Log in manually to continue.', 'error');
        this.onStateChange(AutomationState.ERROR, 'Login required — log in to Railway to continue.');
        return;
      }
    }

    this.onStateChange(AutomationState.COMPLETED, 'Seat selection completed.');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Utilities
  // ══════════════════════════════════════════════════════════════════════════

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