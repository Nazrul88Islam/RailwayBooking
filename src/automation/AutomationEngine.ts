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

  private detectCurrentPageType(): 'HOMEPAGE' | 'SEARCH_RESULTS' | 'SEAT_MAP' {
    // 1. Check for active Seat Map layout or Coach selection dropdown
    const seatMapContainer = document.querySelector(
      '.seat-layout, .seat-plan, #seat_map, [class*="seat-layout"], [class*="seat-grid"], [class*="coach-layout"], .coach-seat-btn'
    );
    const hasCoachDropdown = Array.from(document.querySelectorAll('select')).some(sel => {
      const nameOrId = (sel.name || sel.id || '').toLowerCase();
      const txt = (sel.textContent || '').toUpperCase();
      return (nameOrId.includes('coach') || nameOrId.includes('bogey')) ||
             txt.includes('SEAT(S)') || txt.includes('SEATS AVAILABLE') || txt.includes('CHOICE COACH');
    });

    if (seatMapContainer || hasCoachDropdown) {
      return 'SEAT_MAP';
    }

    // 2. Check for Train Search Results cards
    const trainCards = document.querySelectorAll(
      '.train-item, .train-card, .single-train-details, .search-result-item, [class*="single-train"], [class*="train-item"]'
    );
    if (trainCards.length > 0) {
      return 'SEARCH_RESULTS';
    }

    // 3. Otherwise, HOMEPAGE or search form context
    return 'HOMEPAGE';
  }

  public async start(): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      this.onLog('Automation engine initialized', 'info');
      this.onStateChange(AutomationState.STARTING, 'Starting booking process...');

      // Step 1: Safety check before doing anything
      const safetyHalt = RailwayAdapter.detectSafetyHalt();
      if (safetyHalt) {
        this.handleSafetyHalt(safetyHalt);
        return;
      }

      const pageType = this.detectCurrentPageType();
      this.onLog(`Detected current page context: ${pageType}`, 'info');

      // Step 2, 3, 4: Only run Homepage search steps if currently on Homepage
      if (pageType === 'HOMEPAGE') {
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
        
        if (this.settings.seatClass) {
          await RailwayAdapter.selectClass(this.settings.seatClass, this.settings.actionDelay, signal);
        }

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

        await this.delay(500, signal);

        // If form click did not navigate to search results page, navigate directly via URL parameter format
        if (!window.location.href.includes('/booking/train/search')) {
          this.onLog(`Navigating directly to search results: ${this.settings.fromStation} → ${this.settings.toStation} (${this.settings.journeyDate})...`, 'info');
          RailwayAdapter.navigateToSearchResults(
            this.settings.fromStation,
            this.settings.toStation,
            this.settings.journeyDate,
            this.settings.seatClass
          );
        }
      }

      // Step 5: Run Train Finding if on Search Results page or after homepage search
      if (pageType === 'HOMEPAGE' || pageType === 'SEARCH_RESULTS') {
        this.checkAborted(signal);
        this.onStateChange(AutomationState.SEARCH_RESULTS, 'Waiting for train search results...');
        this.onLog(`Searching for target train '${this.settings.targetTrain}'...`, 'info');

        let trainSelected = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          this.checkAborted(signal);
          trainSelected = await RailwayAdapter.findAndSelectTargetTrain(
            this.settings.targetTrain,
            this.settings.seatClass,
            this.settings.actionDelay,
            signal
          );
          if (trainSelected) {
            this.onLog(`Found and selected target train '${this.settings.targetTrain}'`, 'success');
            break;
          }
          await this.delay(400, signal);
        }

        if (!trainSelected && pageType === 'SEARCH_RESULTS') {
          this.onLog(`Could not locate train '${this.settings.targetTrain}' on search results page.`, 'warning');
        }

        const postSearchHalt = RailwayAdapter.detectSafetyHalt();
        if (postSearchHalt) {
          this.handleSafetyHalt(postSearchHalt);
          return;
        }
      }

      // Step 6: Seat Map Detection & Selection (Runs on SEAT_MAP page or after selecting train)
      this.checkAborted(signal);
      this.onStateChange(AutomationState.WAITING_FOR_SEAT_MAP, 'Waiting for train seat map...');

      let coachMaps: CoachSeatMap[] = [];
      const maxSeatMapAttempts = 40; // Retry up to ~15 seconds for network/DOM render

      for (let attempt = 0; attempt < maxSeatMapAttempts; attempt++) {
        this.checkAborted(signal);

        // 1. If train was clicked but seat map hasn't loaded after 8 attempts, re-trigger target train selection
        if (attempt > 0 && attempt % 8 === 0) {
          this.onLog(`Still waiting for seat map (attempt ${attempt + 1}/${maxSeatMapAttempts}). Re-checking Book Now button for '${this.settings.targetTrain}'...`, 'info');
          RailwayAdapter.findAndSelectTargetTrain(
            this.settings.targetTrain,
            this.settings.seatClass,
            this.settings.actionDelay,
            signal
          ).catch(() => {});
        }

        // 2. Check if a "Select Coach" dropdown is present (e.g. GA - 1 Seat(s)) and select a coach with seats
        const coachSelected = RailwayAdapter.selectBestCoachFromDropdown(this.settings.seatCount);
        if (coachSelected) {
          await this.delay(300, signal);
        }

        // 3. Try clicking coach tab buttons if present
        RailwayAdapter.clickAvailableCoachTab();

        // 4. Parse seats from DOM
        coachMaps = SeatMapParser.parseFromDOM(document);

        if (coachMaps.length > 0) {
          const availableSeatsCount = coachMaps.reduce((acc, c) => acc + c.seats.filter(s => s.isAvailable).length, 0);
          if (availableSeatsCount >= this.settings.seatCount || availableSeatsCount > 0) {
            this.onLog(`Detected seat map with ${availableSeatsCount} available seats across ${coachMaps.length} coach(es)!`, 'success');
            break;
          }
        }

        await this.delay(350, signal);
      }

      if (coachMaps.length > 0) {
        this.onStateChange(AutomationState.ANALYZING_SEATS, `Analyzing seat layouts for ${this.settings.seatCount} seats (${this.settings.seatMode})...`);
        this.onLog(`Found ${coachMaps.length} coach seat maps (${coachMaps.reduce((acc, c) => acc + c.seats.length, 0)} total seats). Running spatial engine...`, 'info');

        const selectionResult = SeatSelectionEngine.selectSeats(
          coachMaps,
          this.settings.seatCount,
          this.settings.seatMode,
          this.settings.allowFallback
        );

        if (selectionResult.success) {
          this.onLog(`Selected ${selectionResult.seats.length} seats: ${selectionResult.seats.map(s => s.name).join(', ')}`, 'success');

          // Click candidate seats
          for (const s of selectionResult.seats) {
            if (s.rawElement) {
              (s.rawElement as HTMLElement).click();
              await this.delay(80, signal);
            }
          }

          await this.delay(this.settings.actionDelay, signal);

          this.onStateChange(AutomationState.CONTINUE, 'Proceeding to checkout step...');
          const continueBtn = RailwayAdapter.findElement([
            '.btn-continue',
            'button.continue-btn',
            '.proceed-btn',
            'button[type="submit"].btn-success',
            '.purchase-btn',
            '[class*="continue"]',
            '[class*="purchase"]'
          ]) || RailwayAdapter.findElementByText('button', 'continue')
            || RailwayAdapter.findElementByText('button', 'purchase')
            || RailwayAdapter.findElementByText('button', 'confirm');

          if (continueBtn) {
            continueBtn.click();
            this.onLog('Clicked Continue / Purchase button!', 'success');
          }

          this.onStateChange(AutomationState.COMPLETED, 'Seat selection finished');
          this.onLog('Automation process completed successfully', 'success');
        } else {
          this.onLog(`Seat selection failed: ${selectionResult.reason}`, 'error');
          this.onStateChange(AutomationState.ERROR, `Seat selection failed: ${selectionResult.reason}`);
          return;
        }
      } else {
        this.onLog(`Seat map did not load or no seat elements were detected for train '${this.settings.targetTrain}'.`, 'error');
        this.onStateChange(AutomationState.ERROR, 'Seat map did not load. Please click Book Now manually.');
        return;
      }

      // Final safety halt check
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
