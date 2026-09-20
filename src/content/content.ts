import { MessageType, ExtensionMessage } from '../shared/messages';
import { AutomationEngine } from '../automation/AutomationEngine';
import { AutomationState, BookingSettings } from '../shared/types';

let currentEngine: AutomationEngine | null = null;

console.log('🚆 Railway Ticket Booking Tools content script active.');

const startAutomationEngine = (settings: BookingSettings) => {
  if (currentEngine) {
    currentEngine.stop();
  }

  currentEngine = new AutomationEngine(
    settings,
    (state: AutomationState, statusText?: string) => {
      chrome.runtime.sendMessage({
        type: MessageType.STATE_UPDATED,
        payload: { state, statusText }
      }).catch(() => {});
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
      }).catch(() => {});
    }
  );

  currentEngine.start();
};

// Check if background worker has an active running automation state on new page load
chrome.runtime.sendMessage({ type: MessageType.GET_STATE }, (response) => {
  console.log(
    '🚆 [Railway] GET_STATE after page load:',
    {
      url: window.location.href,
      state: response?.state,
      settings: response?.settings
    }
  );

  if (response && response.state && response.settings) {
    const activeStates = [
      AutomationState.STARTING,
      AutomationState.SELECTING_ROUTE,
      AutomationState.SELECTING_DATE,
      AutomationState.SEARCHING,
      AutomationState.SEARCH_RESULTS,
      AutomationState.FINDING_TRAIN,
      AutomationState.SELECTING_TRAIN,
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
});
