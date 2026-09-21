import { MessageType, ExtensionMessage } from '../shared/messages';
import { AutomationEngine } from '../automation/AutomationEngine';
import { AutomationState, BookingSettings, SeatDetailRow } from '../shared/types';

let currentEngine: AutomationEngine | null = null;

console.log('🚆 Railway Ticket Booking Tools content script active.');

function renderInPageSeatOverlay(seatDetails?: SeatDetailRow[]) {
  if (!seatDetails || seatDetails.length === 0) return;

  let overlay = document.getElementById('railway-autobot-seat-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'railway-autobot-seat-modal';
    overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 999999;
      background: #0f172a;
      color: #ffffff;
      border: 1px solid #38bdf8;
      border-radius: 10px;
      padding: 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      font-family: system-ui, -apple-system, sans-serif;
      min-width: 280px;
      backdrop-filter: blur(8px);
    `;
    document.body.appendChild(overlay);
  }

  const rowsHtml = seatDetails.map(row => `
    <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
      <td style="padding: 8px 10px; font-weight: 600; color: #38bdf8;">${row.className}</td>
      <td style="padding: 8px 10px; font-weight: 700; color: #facc15;">${row.seats}</td>
      <td style="padding: 8px 10px; text-align: right; font-weight: 600; color: #4ade80;">${row.fare}</td>
    </tr>
  `).join('');

  overlay.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <div style="font-weight: bold; font-size: 15px; color: #4ade80; display: flex; align-items: center; gap: 6px;">
        <span>🎟️</span> <span>Seat Details</span>
      </div>
      <button id="railway-modal-close" style="background: none; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 0 4px;">✕</button>
    </div>
    <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
      <thead>
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.2); color: #94a3b8; font-size: 11px; text-transform: uppercase;">
          <th style="padding: 4px 10px;">Class</th>
          <th style="padding: 4px 10px;">Seats</th>
          <th style="padding: 4px 10px; text-align: right;">Fare</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  document.getElementById('railway-modal-close')?.addEventListener('click', () => {
    overlay?.remove();
  });
}

const startAutomationEngine = (settings: BookingSettings) => {
  if (currentEngine) {
    currentEngine.stop();
  }

  currentEngine = new AutomationEngine(
    settings,
    (state: AutomationState, statusText?: string, seatDetails?: SeatDetailRow[]) => {
      if (seatDetails) {
        renderInPageSeatOverlay(seatDetails);
      }
      chrome.runtime.sendMessage({
        type: MessageType.STATE_UPDATED,
        payload: { state, statusText, seatDetails }
      }, () => {
        if (chrome.runtime.lastError) {
          // Popup closed, suppress unhandled lastError warning
        }
      });
    },
    (msg: string, type: 'info' | 'success' | 'warning' | 'error') => {
      console.log(`[Autobot] ${type.toUpperCase()}: ${msg}`);
      chrome.runtime.sendMessage({
        type: MessageType.LOG_ADDED,
        payload: {
          id: Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toLocaleTimeString('en-GB'),
          message: msg,
          type
        }
      }, () => {
        if (chrome.runtime.lastError) {
          // Popup closed, suppress unhandled lastError warning
        }
      });
    }
  );

  currentEngine.start();
};

// Check if background worker has an active running automation state on new page load
chrome.runtime.sendMessage({ type: MessageType.GET_STATE }, (response) => {
  if (chrome.runtime.lastError) {
    // Service worker waking up or disconnected, suppress error
    return;
  }

  console.log(
    '🚆 [Railway] GET_STATE after page load:',
    {
      url: window.location.href,
      state: response?.state,
      settings: response?.settings,
      seatDetails: response?.seatDetails
    }
  );

  if (response?.seatDetails) {
    renderInPageSeatOverlay(response.seatDetails);
  }

  if (response && response.state && response.settings) {
    const activeStates = [
      AutomationState.STARTING,
      AutomationState.CONFIGURED,
      AutomationState.WAITING_FOR_BOOKING_TIME,
      AutomationState.HOME_PAGE,
      AutomationState.SELECTING_ROUTE,
      AutomationState.SELECTING_DATE,
      AutomationState.SEARCHING,
      AutomationState.SEARCH_RESULTS,
      AutomationState.FINDING_TRAIN,
      AutomationState.SELECTING_TRAIN,
      AutomationState.SELECTING_CLASS,
      AutomationState.WAITING_FOR_SEAT_MAP,
      AutomationState.ANALYZING_SEATS,
      AutomationState.SELECTING_SEATS,
      AutomationState.CONTINUE
    ];

    if (activeStates.includes(response.state)) {
      console.log(`🚆 Resuming active automation state [${response.state}] on ${window.location.pathname}`);
      startAutomationEngine(response.settings);
    }
  }
});


chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === MessageType.START_AUTOMATION) {
    const settings: BookingSettings = message.payload?.settings;
    if (!settings) return;

    startAutomationEngine(settings);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === MessageType.STOP_AUTOMATION) {
    if (currentEngine) {
      currentEngine.stop();
      currentEngine = null;
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === MessageType.STATE_UPDATED) {
    if (message.payload?.seatDetails) {
      renderInPageSeatOverlay(message.payload.seatDetails);
    }
  }
});

