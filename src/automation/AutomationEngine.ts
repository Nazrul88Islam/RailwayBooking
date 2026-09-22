import { BookingSettings, AutomationState, LogItem, SeatDetailRow } from '../shared/types';
import { RailwayAdapter, CoachOption } from '../content/railway/RailwayAdapter';
import { SeatMapParser } from './seat/SeatMapParser';
import { SeatSelectionEngine } from './seat/SeatSelectionEngine';
import { CoachSeatMap, SeatInfo } from './seat/SeatTypes';

/** Bangladesh Railway lets you book at most 4 seats per transaction. */
const MAX_SEATS_PER_BOOKING = 4;

/** What the user is asked when the exact layout is not available. */
export interface FallbackRequest {
  /** e.g. "2 Seats (Adjacent Pair)" */
  requested: string;
  coach: string;
  /** e.g. ["GA-UP-2", "GA-UP-4"] */
  seats: string[];
  /** e.g. "face-to-face (same column, next row)" */
  arrangement: string;
  /** Ready-to-show text (used by the default confirm() dialog). */
  message: string;
}
export type ConfirmFallback = (request: FallbackRequest) => Promise<boolean>;

interface SeatPlan {
  coachName: string;
  seats: SeatInfo[];
  modeUsed: string;
  reason?: string;
}

export class AutomationEngine {
  private abortController: AbortController | null = null;
  private settings: BookingSettings;
  private onStateChange: (state: AutomationState, statusText?: string, seatDetails?: SeatDetailRow[]) => void;
  private onLog: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  private confirmFallback?: ConfirmFallback;

  /** URL of the train list the seat panel was opened from ("the original page"). */
  private resultsUrl = '';
  /** Once you approve an alternative layout you are not asked again in later rounds. */
  private fallbackApproved = false;

  /**
   * @param confirmFallback  Called when the exact layout you asked for is not available anywhere and an
   *                         alternative exists. Resolve `true` to book the alternative, `false` to go back
   *                         to the original page. Optional: without it the browser's own confirm() dialog is used.
   */
  constructor(
    settings: BookingSettings,
    onStateChange: (state: AutomationState, statusText?: string, seatDetails?: SeatDetailRow[]) => void,
    onLog: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void,
    confirmFallback?: ConfirmFallback
  ) {
    this.settings = settings;
    this.onStateChange = onStateChange;
    this.onLog = onLog;
    this.confirmFallback = confirmFallback;
  }

  /**
   * Number of seats to book. Popup/storage values often arrive as strings ("2"), and the old
   * strict `seats.length !== settings.seatCount` check then ALWAYS failed. Always coerce.
   * Capped at the site's limit of 4 seats per booking.
   */
  private get seatCount(): number {
    const n = Math.floor(Number(this.settings.seatCount));
    const wanted = Number.isFinite(n) && n > 0 ? n : 1;
    return Math.min(wanted, MAX_SEATS_PER_BOOKING);
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
      SeatMapParser.seatClassHint = this.settings.seatClass || '';
      this.onLog('Automation engine initialized', 'info');
      this.onStateChange(AutomationState.STARTING, 'Starting booking process...');

      if (Number(this.settings.seatCount) > MAX_SEATS_PER_BOOKING) {
        this.onLog(
          `Railway allows at most ${MAX_SEATS_PER_BOOKING} seats per booking — using ${MAX_SEATS_PER_BOOKING} instead of ${this.settings.seatCount}.`,
          'warning'
        );
      }

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

      // ── STEP 2a: Wait until the target date is open on the site ─────────────
      if (this.isHomePage()) {
        const dateReady = await this.waitUntilDateAvailable(signal);
        if (!dateReady) return; // timed out or aborted
      }

      // ── STEP 2b: Homepage form fill & search ───────────────────────────────
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

      // ── STEP 5: wait until the seat page is ready ─────────────────────────
      if (!(await this.waitForSeatMapReady(signal))) return;

      // ── STEP 6: scan coaches → best coach/seats for the mode → click seats ─
      const selectedSeats = await this.chooseAndSelectSeats(signal);
      if (!selectedSeats) return; // error already reported

      // ── STEP 7: final cart check → Continue → final safety check ───────────
      await this.continueToNextStep(selectedSeats, signal);
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
  // STEP 2a — wait until the booking date is open on the site
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Before the site opens booking for a date (e.g. Oct 1 tickets open at 8:00 AM),
   * the day cell is either absent from the calendar or marked disabled.  This method
   * polls the date-picker every 5 seconds for up to 20 minutes from the moment Start
   * was pressed.  As soon as the target date becomes selectable it returns `true` so
   * the normal form-fill + search flow can begin.
   *
   * If the calendar cannot be opened at all (no date input found on the page) we skip
   * this check and let `fillFormAndSearch` handle it — the site may already show the
   * right results or an input-less flow may be used.
   */
  private async waitUntilDateAvailable(signal: AbortSignal): Promise<boolean> {
    this.checkAborted(signal);

    const date = this.settings.journeyDate;
    if (!date) return true; // no date configured → skip wait

    // Maximum wait = 20 minutes from now
    const MAX_WAIT_MS    = 20 * 60 * 1000;
    const POLL_INTERVAL  = 5_000; // 5 seconds between each calendar peek
    const startedAt      = Date.now();
    const deadline       = startedAt + MAX_WAIT_MS;

    // ── First, open the calendar and do an immediate check ────────────────
    const pickerOpened = RailwayAdapter.openDatePicker();
    if (!pickerOpened) {
      // Date input not found on this page — skip the wait entirely
      this.onLog(
        `Date-picker not found on the page — skipping date-availability check (will attempt to set date during form fill).`,
        'info'
      );
      return true;
    }

    // Give the calendar a moment to render
    await this.delay(400, signal);

    let attempt = 0;
    while (Date.now() < deadline) {
      this.checkAborted(signal);
      attempt++;

      const status = RailwayAdapter.isJourneyDateAvailable(date);
      const elapsedSec  = Math.round((Date.now() - startedAt) / 1000);
      const remainingSec = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      const remainingMin = Math.floor(remainingSec / 60);
      const remainingSs  = remainingSec % 60;

      if (status === 'available') {
        this.onLog(
          `✅ Journey date ${date} is now available in the calendar (check #${attempt}, elapsed ${elapsedSec}s). Proceeding with booking.`,
          'success'
        );
        this.onStateChange(AutomationState.SELECTING_DATE, `Date ${date} is open — starting booking...`);
        // Close the calendar so the subsequent form-fill can open it cleanly
        document.body.click();
        await this.delay(200, signal);
        return true;
      }

      if (status === 'disabled') {
        this.onLog(
          `⏳ Date ${date} is visible but still disabled (check #${attempt}). Waiting... [${remainingMin}m ${remainingSs}s remaining]`,
          'warning'
        );
      } else {
        // 'not_visible': calendar might have closed; re-open it
        this.onLog(
          `⏳ Date ${date} not yet in calendar (check #${attempt}) — booking window not open yet. [${remainingMin}m ${remainingSs}s remaining]`,
          'info'
        );
        RailwayAdapter.openDatePicker();
      }

      this.onStateChange(
        AutomationState.WAITING_FOR_BOOKING_TIME,
        `Waiting for ${date} to open on the site... [${remainingMin}m ${remainingSs}s left]`
      );

      // Wait 5 s (in interruptible 50 ms slices so Stop works immediately)
      await this.delay(POLL_INTERVAL, signal);

      // Re-open the calendar every poll cycle in case it auto-closed
      RailwayAdapter.openDatePicker();
      await this.delay(400, signal);
    }

    this.onLog(
      `⏰ Timed out after 20 minutes waiting for journey date ${date} to become available. The booking window may not have opened. Stopping.`,
      'error'
    );
    this.onStateChange(
      AutomationState.ERROR,
      `Journey date ${date} did not become available within 20 minutes. Try again or check the site manually.`
    );
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2b — homepage form
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
        this.resultsUrl = window.location.href;
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
  // STEP 5 — wait for the seat page
  // ══════════════════════════════════════════════════════════════════════════

  private countAvailable(maps: CoachSeatMap[]): number {
    return maps.reduce(
      (total, coach) => total + coach.seats.filter(seat => seat.isAvailable).length,
      0
    );
  }

  private async waitForSeatMapReady(signal: AbortSignal): Promise<boolean> {
    this.checkAborted(signal);
    this.onStateChange(
      AutomationState.WAITING_FOR_SEAT_MAP,
      `Waiting for ${this.settings.seatClass} seat map...`
    );

    const maxAttempts = 40;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      this.checkAborted(signal);

      if (this.isHomePage()) {
        this.onLog('Page returned to homepage while waiting for seat map. Aborting.', 'error');
        this.onStateChange(AutomationState.ERROR, 'Railway returned to homepage unexpectedly.');
        return false;
      }

      const coaches = RailwayAdapter.getCoachOptions();
      const seatsOnPage = this.countAvailable(SeatMapParser.parseFromDOM(document));

      this.onLog(
        `Seat page check ${attempt + 1}/${maxAttempts}: ${coaches.length} coach(es) listed, ${seatsOnPage} seat(s) on page.`,
        'info'
      );

      if (coaches.length > 0 || seatsOnPage > 0) return true;
      await this.delay(350, signal);
    }

    this.onLog(`No seat map detected for ${this.settings.targetTrain} / ${this.settings.seatClass}.`, 'error');
    this.onStateChange(AutomationState.ERROR, 'Seat map was not loaded.');
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6 — find the best coach + seats, then click them
  // ══════════════════════════════════════════════════════════════════════════

  /** Parse the page and mark seats we already failed to click as unavailable. */
  private readMaps(excluded: Set<string>): CoachSeatMap[] {
    const maps = SeatMapParser.parseFromDOM(document);
    maps.forEach(m => m.seats.forEach(s => {
      if (excluded.has(s.id)) s.isAvailable = false;
    }));
    return maps;
  }

  private findFreshSeat(seat: SeatInfo): SeatInfo | null {
    for (const map of SeatMapParser.parseFromDOM(document)) {
      const hit = map.seats.find(s => s.id === seat.id);
      if (hit) return hit;
    }
    return null;
  }

  /** The DOM node may have been re-rendered since we parsed it — re-resolve it by seat id. */
  private resolveSeatElement(seat: SeatInfo): HTMLElement | null {
    const raw = seat.rawElement as HTMLElement | undefined;
    if (raw && raw.isConnected) return raw;
    const fresh = this.findFreshSeat(seat);
    return (fresh?.rawElement as HTMLElement | undefined) || null;
  }

  private coachSignature(map: CoachSeatMap): string {
    return map.seats.map(s => `${s.name}:${s.isAvailable ? 1 : 0}`).join('|');
  }

  /** Switch the dropdown to `opt` and wait until the new coach's seat layout has rendered. */
  private async loadCoach(opt: CoachOption, excluded: Set<string>, signal: AbortSignal): Promise<CoachSeatMap | null> {
    const alreadySelected = RailwayAdapter.getSelectedCoachIndex() === opt.index;
    if (!alreadySelected) {
      RailwayAdapter.selectCoachOption(opt);
    }
    await this.delay(alreadySelected ? 100 : 400, signal);

    // Wait until two consecutive parses agree (layout finished rendering)
    let previous = '';
    for (let i = 0; i < 20; i++) {
      this.checkAborted(signal);
      const maps = this.readMaps(excluded);
      const map = maps.find(m => m.coachName === opt.coachName) || maps[0];

      if (map && map.seats.length > 0) {
        const sig = this.coachSignature(map);
        if (sig === previous) return map;
        previous = sig;
      }
      await this.delay(150, signal);
    }
    return null;
  }

  private logCoach(map: CoachSeatMap): void {
    const avail = map.seats.filter(s => s.isAvailable).length;
    this.onLog(
      `Coach ${map.coachName}: ${avail} available of ${map.seats.length} seat(s) parsed (${map.rows} rows × ${map.cols} cols).`,
      'info'
    );
    console.log(`[Railway] Seat grid for coach ${map.coachName} (x = booked/in-progress, * = selected, | = aisle):\n${SeatMapParser.formatGrid(map)}`);
  }

  private fail(logMsg: string, status: string): null {
    this.onLog(logMsg, 'error');
    this.onStateChange(AutomationState.ERROR, status);
    return null;
  }

  /**
   * Choose the best coach and seats for the requested seat count + mode.
   *
   *  1. Coaches that cannot hold `need` seats are skipped; the rest are tried largest-first.
   *  2. The first coach that satisfies the requested mode EXACTLY wins (and stays selected).
   *  3. If none does and fallback is allowed, the coach offering the closest arrangement wins
   *     (adjacent > face-to-face > best available).
   */
  private async planBestSeats(excluded: Set<string>, signal: AbortSignal): Promise<SeatPlan | null> {
    const need = this.seatCount;
    const mode = this.settings.seatMode;
    const allowFallback = this.settings.allowFallback;

    // ── Page without a coach dropdown (single view or coach tabs) ──────────
    if (!RailwayAdapter.hasCoachDropdown()) {
      for (let i = 0; i < 8; i++) {
        this.checkAborted(signal);
        const maps = this.readMaps(excluded);
        if (maps.length) {
          const strict = SeatSelectionEngine.selectSeats(maps, need, mode, false);
          if (strict.success && strict.seats.length === need) {
            return { coachName: strict.seats[0].coach, seats: strict.seats, modeUsed: strict.modeUsed };
          }
        }
        if (!RailwayAdapter.clickAvailableCoachTab()) break;
        await this.delay(450, signal);
      }

      const maps = this.readMaps(excluded);
      if (!maps.length) return this.fail('No seats could be read from the page.', 'Seat map was not loaded.');
      maps.forEach(m => this.logCoach(m));

      const exact = SeatSelectionEngine.selectSeats(maps, need, mode, false);
      if (exact.success && exact.seats.length === need) {
        return { coachName: exact.seats[0].coach, seats: exact.seats, modeUsed: exact.modeUsed };
      }
      if (!allowFallback) return this.failNoExactLayout();

      const res = SeatSelectionEngine.selectSeats(maps, need, mode, true);
      if (!res.success || res.seats.length !== need) {
        return this.fail(`Seat selection failed: ${res.reason}`, res.reason || 'Seat selection failed.');
      }
      if (!(await this.approveAlternative(res.seats[0].coach, res.seats, res.modeUsed, res.reason, signal))) {
        return this.declineAlternative(signal);
      }
      return { coachName: res.seats[0].coach, seats: res.seats, modeUsed: res.modeUsed, reason: res.reason };
    }

    // ── Dropdown: scan coaches (the one already on screen first, then largest first) ──
    const currentCoachIdx = RailwayAdapter.getSelectedCoachIndex();
    const options = RailwayAdapter.getCoachOptions()
      .filter(o => o.available >= need)
      .sort((a, b) => {
        if (a.index === currentCoachIdx) return -1;
        if (b.index === currentCoachIdx) return 1;
        return b.available - a.available;
      });

    if (!options.length) {
      return this.fail(
        `No coach has ${need} available seat(s).`,
        `Not enough ${this.settings.seatClass} seats available (need ${need} in one coach).`
      );
    }

    this.onLog(
      `Coaches with ≥${need} seat(s): ${options.map(o => `${o.coachName}(${o.available})`).join(', ')} — looking for mode '${mode}'.`,
      'info'
    );

    const scanned: { opt: CoachOption; map: CoachSeatMap }[] = [];
    let lastLoaded: CoachOption | null = null;

    for (const opt of options) {
      this.checkAborted(signal);
      this.onStateChange(AutomationState.ANALYZING_SEATS, `Checking coach ${opt.coachName} for ${need} seat(s) (${mode})...`);

      const map = await this.loadCoach(opt, excluded, signal);
      lastLoaded = opt;

      if (!map) {
        this.onLog(`Coach ${opt.coachName}: seat layout did not load, skipping.`, 'warning');
        continue;
      }

      this.logCoach(map);

      const strict = SeatSelectionEngine.selectSeats([map], need, mode, false);
      if (strict.success && strict.seats.length === need) {
        this.onLog(`Coach ${opt.coachName} satisfies mode '${mode}'.`, 'success');
        return { coachName: opt.coachName, seats: strict.seats, modeUsed: strict.modeUsed };
      }

      this.onLog(`Coach ${opt.coachName} cannot satisfy mode '${mode}' for ${need} seat(s).`, 'info');
      scanned.push({ opt, map });
    }

    if (!scanned.length) {
      return this.fail('Could not read the seat layout of any coach.', 'Seat map was not loaded.');
    }

    if (!allowFallback) return this.failNoExactLayout();

    // ── Fallback: pick the coach with the closest arrangement ──────────────
    const ranked = scanned
      .map(s => ({ ...s, res: SeatSelectionEngine.selectSeats([s.map], need, mode, true) }))
      .filter(r => r.res.success && r.res.seats.length === need)
      .sort((a, b) => SeatSelectionEngine.rankResult(a.res) - SeatSelectionEngine.rankResult(b.res));

    if (!ranked.length) {
      return this.fail(`No coach has ${need} usable seat(s).`, `Not enough ${this.settings.seatClass} seats available.`);
    }

    const best = ranked[0];

    // The exact layout does not exist in ANY coach. Nothing has been selected yet — ask first.
    if (!(await this.approveAlternative(best.opt.coachName, best.res.seats, best.res.modeUsed, best.res.reason, signal))) {
      return this.declineAlternative(signal);
    }

    this.onLog(
      `Mode '${mode}' not available anywhere — falling back: coach ${best.opt.coachName}, ${best.res.modeUsed} (${best.res.reason || 'closest match'}).`,
      'warning'
    );

    if (lastLoaded && best.opt.index !== lastLoaded.index) {
      const map = await this.loadCoach(best.opt, excluded, signal);
      if (!map) return this.fail(`Could not reload coach ${best.opt.coachName}.`, 'Seat map was not loaded.');
      const res = SeatSelectionEngine.selectSeats([map], need, mode, true);
      if (!res.success || res.seats.length !== need) {
        return this.fail(`Seat selection failed: ${res.reason}`, res.reason || 'Seat selection failed.');
      }
      return { coachName: best.opt.coachName, seats: res.seats, modeUsed: res.modeUsed, reason: res.reason };
    }

    return { coachName: best.opt.coachName, seats: best.res.seats, modeUsed: best.res.modeUsed, reason: best.res.reason };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Exact layout not available → ask the user (never silently book something else)
  // ══════════════════════════════════════════════════════════════════════════

  /** "2 Seats (Adjacent Pair)" — same wording as the dropdown. */
  private requestedLabel(): string {
    const n = this.seatCount;
    const mode = this.settings.seatMode;
    if (n === 1) return '1 Seat';
    if (mode === 'adjacent') return `${n} Seats (Adjacent${n === 2 ? ' Pair' : ''})`;
    if (mode === 'face_to_face') return `${n} Seats (Face-to-Face)`;
    if (mode === 'best_available') return `${n} Seats (Best Available)`;
    return `${n} Seats`;
  }

  private describeArrangement(modeUsed: string, reason?: string): string {
    const r = reason || '';
    if (r.includes('consecutive')) return 'consecutive seat numbers, not side by side';
    if (r.includes('face-to-face')) return 'face-to-face (same column, next row)';
    if (r.includes('same physical row')) return 'same row, possibly across the aisle';
    if (modeUsed === 'adjacent') return 'side by side';
    if (modeUsed === 'face_to_face') return 'face-to-face (same column, next row)';
    return 'closest available seats, not together';
  }

  private failNoExactLayout(): null {
    const label = this.requestedLabel();
    return this.fail(
      `${label} is not available in any coach, and fallback is off — nothing was booked.`,
      `${label} is not available (fallback is off).`
    );
  }

  /** Ask the user; also honours Stop while the question is open. */
  private async askUser(request: FallbackRequest, signal: AbortSignal): Promise<boolean> {
    this.checkAborted(signal);
    const answer: Promise<boolean> = this.confirmFallback
      ? this.confirmFallback(request)
      : Promise.resolve(window.confirm(request.message));
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Automation aborted by user')), { once: true });
    });
    return Promise.race([answer, aborted]);
  }

  /** true = book the alternative, false = user said no. */
  private async approveAlternative(
    coach: string,
    seats: SeatInfo[],
    modeUsed: string,
    reason: string | undefined,
    signal: AbortSignal
  ): Promise<boolean> {
    if (this.fallbackApproved) return true;

    const requested = this.requestedLabel();
    const names = seats.map(s => SeatMapParser.formatSeatWithCoach(s.name, s.coach || coach));
    const arrangement = this.describeArrangement(modeUsed, reason);
    const message =
      `${requested} is not available in any coach.\n\n` +
      `Closest alternative: coach ${coach} — ${names.join(' + ')} (${arrangement}).\n\n` +
      `OK = book these seats instead\n` +
      `Cancel = don't book, go back to the original page`;

    this.onLog(`${requested} is not available in any coach. Asking you about: coach ${coach} — ${names.join(' + ')} (${arrangement}).`, 'warning');
    this.onStateChange(AutomationState.ANALYZING_SEATS, `Waiting for your decision: ${requested} is not available.`);

    const ok = await this.askUser({ requested, coach, seats: names, arrangement, message }, signal);
    if (ok) {
      this.fallbackApproved = true;
      this.onLog('You approved the alternative seats — continuing.', 'success');
    }
    return ok;
  }

  private async declineAlternative(signal: AbortSignal): Promise<null> {
    this.onLog('You chose not to book the alternative seats.', 'warning');
    await this.returnToOriginalPage(signal);
    return null;
  }

  /**
   * "No" → nothing is booked and the page goes back to where the seat panel was opened from
   * (the train list): first via the panel's own Close link, otherwise by reloading that page.
   */
  private async returnToOriginalPage(signal: AbortSignal): Promise<void> {
    // Nothing was selected yet, but never leave held seats behind
    await this.clearCart(signal);

    const closeBtn = RailwayAdapter.findCloseSeatPanelButton();
    if (closeBtn) {
      this.onLog('Closing the seat panel…', 'info');
      closeBtn.click();
      await this.delay(600, signal);
    }

    const stillOpen = RailwayAdapter.isSeatMapVisible();
    this.onStateChange(AutomationState.IDLE, 'Cancelled — alternative seats declined. Nothing was booked; back on the original page.');
    this.onLog('Back on the original page. Nothing was booked.', 'info');

    if (stillOpen) {
      if (this.resultsUrl && window.location.href !== this.resultsUrl) window.location.href = this.resultsUrl;
      else window.location.reload();
    }
  }

  // ── The "Seat Details" table is the source of truth ─────────────────────
  //
  // Railway KEEPS selected seats when you switch coach, so seats from earlier attempts pile up
  // in other coaches (e.g. KA-6 + TA-7 + THA-3). What we clicked in the current coach tells us
  // nothing about that — only the Seat Details table does.

  private readCart(): string[] | null {
    return SeatMapParser.readSeatDetailsCart(document);
  }

  private async waitForCart(
    predicate: (cart: string[]) => boolean,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    for (; ;) {
      this.checkAborted(signal);
      const cart = this.readCart();
      if (cart === null) return false;
      if (predicate(cart)) return true;
      if (Date.now() >= end) return false;
      await this.delay(150, signal);
    }
  }

  private hasStrictCode(seat: SeatInfo): boolean {
    return /^[A-Z\u0980-\u09FF]{1,5}(?:-[A-Z]{1,5})?-\d{1,3}$/i.test(seat.name);
  }

  /** Deselect one seat, wherever it is: switch to its coach, click it, wait until the cart drops it. */
  private async deselectSeatByCode(code: string, signal: AbortSignal): Promise<boolean> {
    const prefix = SeatMapParser.extractCoachPrefixFromSeatCode(code);
    const opt = RailwayAdapter.getCoachOptions(true).find(o => o.coachName === prefix);
    if (opt) await this.loadCoach(opt, new Set(), signal);

    const seats = ([] as SeatInfo[]).concat(...SeatMapParser.parseFromDOM(document).map(m => m.seats));
    const seat = seats.find(x => x.name.toUpperCase() === code.toUpperCase());
    const el = seat?.rawElement as HTMLElement | undefined;
    if (!el) {
      this.onLog(`Could not find seat ${code} on the page to release it.`, 'warning');
      return false;
    }

    el.click();
    return this.waitForCart(c => !c.includes(code.toUpperCase()), 4000, signal);
  }

  /** Release EVERY seat listed in Seat Details (all coaches). Returns true when the cart is empty. */
  private async clearCart(signal: AbortSignal): Promise<boolean> {
    let cart = this.readCart();

    if (cart === null) {
      // No Seat Details panel found — best effort: only the coach on screen
      RailwayAdapter.clearAllSelectedSeats();
      return true;
    }

    for (let pass = 0; pass < 3 && cart.length > 0; pass++) {
      this.onLog(`Releasing ${cart.length} seat(s) held in Seat Details: ${cart.join(', ')}`, 'warning');
      for (const code of [...cart]) {
        await this.deselectSeatByCode(code, signal);
      }
      cart = this.readCart() ?? [];
    }
    return cart.length === 0;
  }

  /** Compare the Seat Details table with the seats we meant to select. */
  private verifySelection(expected: SeatInfo[]): { ok: boolean; unknown: boolean; missing: string[]; extras: string[]; cart: string[] } {
    const cart = this.readCart();
    if (cart === null) return { ok: true, unknown: true, missing: [], extras: [], cart: [] };

    if (!expected.every(s => this.hasStrictCode(s))) {
      const ok = cart.length === expected.length;
      return { ok, unknown: false, missing: ok ? [] : ['(count mismatch)'], extras: [], cart };
    }

    const exp = expected.map(s => s.name.toUpperCase());
    const missing = exp.filter(c => !cart.includes(c));
    const extras = cart.filter(c => !exp.includes(c));
    return { ok: missing.length === 0 && extras.length === 0 && cart.length === expected.length, unknown: false, missing, extras, cart };
  }

  /** Fallback when there is no Seat Details table: did clicking `seat` visibly change it? */
  private async confirmSeatClicked(seat: SeatInfo, htmlBefore: string, signal: AbortSignal): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      await this.delay(100, signal);

      const fresh = this.findFreshSeat(seat);
      if (fresh && fresh.isSelected && !seat.isSelected) return true;

      const el = this.resolveSeatElement(seat);
      if (el && el.outerHTML !== htmlBefore) return true;
    }
    return false;
  }

  /** Click each seat and confirm it landed in Seat Details. Returns which seats worked / failed. */
  private async clickSeats(
    seats: SeatInfo[],
    signal: AbortSignal
  ): Promise<{ confirmed: SeatInfo[]; failed: SeatInfo[] }> {
    const confirmed: SeatInfo[] = [];
    const failed: SeatInfo[] = [];
    const useCart = this.readCart() !== null && seats.every(s => this.hasStrictCode(s));

    const confirm = async (seat: SeatInfo, before: string): Promise<boolean> =>
      useCart
        ? this.waitForCart(c => c.includes(seat.name.toUpperCase()), 4000, signal)
        : this.confirmSeatClicked(seat, before, signal);

    for (const seat of seats) {
      this.checkAborted(signal);

      if (!seat.isAvailable) {
        this.onLog(`Seat ${seat.name}: not available (booked / in progress / disabled on the page).`, 'warning');
        failed.push(seat);
        continue;
      }

      let el = this.resolveSeatElement(seat);
      if (!el) {
        this.onLog(`Seat ${seat.name}: element not found on page.`, 'warning');
        failed.push(seat);
        continue;
      }

      // The page's own disabled state is the final word: a disabled seat cannot be selected
      if (!SeatMapParser.canDOMSelect(el)) {
        this.onLog(`Seat ${seat.name}: disabled on the page right now — cannot be selected.`, 'warning');
        failed.push(seat);
        continue;
      }

      const before = el.outerHTML;
      el.click();
      let ok = await confirm(seat, before);

      if (!ok) {
        // Seat is not in the cart → it is NOT selected, so a second click is safe
        el = this.resolveSeatElement(seat);
        if (el && SeatMapParser.canDOMSelect(el) && (useCart || el.outerHTML === before)) {
          el.click();
          ok = await confirm(seat, before);
        }
      }

      if (ok) {
        confirmed.push(seat);
      } else {
        this.onLog(`Seat ${seat.name}: click did not select it (taken by someone else?).`, 'warning');
        failed.push(seat);
      }
    }

    return { confirmed, failed };
  }

  /**
   * Clean start → plan → click → verify against Seat Details. If anything is off, EVERYTHING in
   * the cart is released (all coaches) and a new plan is made without the failed seats
   * (max 3 rounds). Returns the selected seats, or null (error already reported).
   */
  private async chooseAndSelectSeats(signal: AbortSignal): Promise<SeatInfo[] | null> {
    const need = this.seatCount;
    const excluded = new Set<string>();
    const maxRounds = 3;

    // Seats left over from earlier attempts (any coach) would end up in the booking
    if (!(await this.clearCart(signal))) {
      return this.fail(
        'Seats from an earlier attempt are still held in Seat Details and could not be released. Remove them manually, then start again.',
        'Old seats are still selected — remove them and start again.'
      );
    }

    for (let round = 1; round <= maxRounds; round++) {
      this.checkAborted(signal);
      this.onStateChange(
        AutomationState.ANALYZING_SEATS,
        `Finding best ${need} ${this.settings.seatClass} seat(s) — mode '${this.settings.seatMode}' (round ${round}/${maxRounds})...`
      );

      const plan = await this.planBestSeats(excluded, signal);
      if (!plan) return null;

      const seatCodeList = plan.seats.map(s => SeatMapParser.formatSeatWithCoach(s.name, s.coach || plan.coachName)).join(', ');

      this.onLog(
        `Selecting ${plan.seats.length} seat(s) in coach ${plan.coachName} [${plan.modeUsed}${plan.reason ? ' — ' + plan.reason : ''}]: ${seatCodeList}`,
        'success'
      );

      const { confirmed, failed } = await this.clickSeats(plan.seats, signal);

      // Let Seat Details settle, then compare it with the plan
      if (this.readCart() !== null) {
        await this.waitForCart(c => c.length === plan.seats.length, 2500, signal);
      }
      const check = this.verifySelection(plan.seats);

      if (failed.length === 0 && confirmed.length === need && check.ok) {
        if (!check.unknown) {
          this.onLog(`Seat Details confirms exactly ${need} seat(s): ${check.cart.join(', ')}`, 'success');
        }
        return plan.seats;
      }

      this.onLog(
        `Round ${round}/${maxRounds}: selection is not what was planned` +
        (check.unknown ? '' : ` (Seat Details: ${check.cart.join(', ') || 'empty'}; missing: ${check.missing.join(', ') || '-'}; unexpected: ${check.extras.join(', ') || '-'})`) +
        '. Releasing all selected seats and re-planning...',
        'warning'
      );

      if (check.unknown) {
        for (const seat of confirmed) {
          const el = this.resolveSeatElement(seat);
          if (el) el.click();
          await this.delay(120, signal);
        }
      } else if (!(await this.clearCart(signal))) {
        return this.fail(
          'Could not release the seats from the failed attempt — stopping so no extra seats are booked.',
          'Could not release extra seats — check Seat Details.'
        );
      }

      failed.forEach(s => excluded.add(s.id));
      plan.seats
        .filter(s => check.missing.includes(s.name.toUpperCase()))
        .forEach(s => excluded.add(s.id));
    }

    return this.fail(
      `Could not select exactly ${need} seat(s) after ${maxRounds} attempts. No checkout action was performed.`,
      `Could not select exactly ${need} seat(s).`
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 7 — Continue + final safety checks
  // ══════════════════════════════════════════════════════════════════════════

  private async continueToNextStep(selectedSeats: SeatInfo[], signal: AbortSignal): Promise<void> {
    const selectedCount = selectedSeats.length;
    await this.delay(this.settings.actionDelay, signal);

    // Never continue unless Seat Details lists EXACTLY the seats we planned
    const finalCheck = this.verifySelection(selectedSeats);
    if (!finalCheck.ok) {
      this.onLog(
        `Seat Details shows [${finalCheck.cart.join(', ') || 'nothing'}] but expected exactly [${selectedSeats.map(s => s.name).join(', ')}]. Not continuing.`,
        'error'
      );
      this.onStateChange(AutomationState.ERROR, 'Selected seats do not match the plan — not continuing.');
      return;
    }

    const seatDetails = SeatMapParser.readFullSeatDetailsCart(document, selectedSeats, this.settings.seatClass);

    this.onStateChange(
      AutomationState.SELECTING_SEATS,
      `Selected ${selectedCount} ${this.settings.seatClass} seat(s): ${selectedSeats.map(s => SeatMapParser.formatSeatWithCoach(s.name, s.coach)).join(', ')}`,
      seatDetails
    );

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
      this.onStateChange(AutomationState.ERROR, 'Continue button not found.', seatDetails);
      return;
    }

    continueBtn.click();
    this.onLog(`Continue clicked with ${selectedCount} ${this.settings.seatClass} seat(s).`, 'success');

    this.onStateChange(
      AutomationState.CONTINUE,
      `Continue clicked with ${selectedCount} ${this.settings.seatClass} seat(s).`,
      seatDetails
    );

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