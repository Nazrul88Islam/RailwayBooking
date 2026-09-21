import { MessageType, ExtensionMessage } from '../shared/messages';
import { AutomationState, LogItem, BookingSettings, SeatDetailRow } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/constants';

let currentSettings: BookingSettings = DEFAULT_SETTINGS;
let currentState: AutomationState = AutomationState.IDLE;
let currentStatusText: string = 'Ready';
let currentSeatDetails: SeatDetailRow[] | undefined = undefined;
let currentLogs: LogItem[] = [
  {
    id: 'sw-init',
    timestamp: new Date().toLocaleTimeString('en-GB'),
    message: 'Service Worker initialized',
    type: 'info'
  }
];

// Helper to broadcast state updates to popup and content scripts
function broadcastStateUpdate() {
  const updateMessage: ExtensionMessage = {
    type: MessageType.STATE_UPDATED,
    payload: {
      state: currentState,
      statusText: currentStatusText,
      logs: currentLogs,
      settings: currentSettings,
      seatDetails: currentSeatDetails
    }
  };

  chrome.runtime.sendMessage(updateMessage, () => {
    if (chrome.runtime.lastError) {
      // Popup might be closed, suppress unhandled lastError warning
    }
  });
}

function addLog(message: string, type: 'info' | 'success' | 'warning' | 'error') {
  const item: LogItem = {
    id: Math.random().toString(36).substring(2, 9),
    timestamp: new Date().toLocaleTimeString('en-GB'),
    message,
    type
  };
  currentLogs.push(item);
  if (currentLogs.length > 100) currentLogs.shift();

  chrome.runtime.sendMessage({
    type: MessageType.LOG_ADDED,
    payload: item
  }, () => {
    if (chrome.runtime.lastError) {
      // Popup closed, suppress unhandled lastError warning
    }
  });
}

// Handle incoming message requests
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === MessageType.GET_STATE) {
    sendResponse({
      state: currentState,
      statusText: currentStatusText,
      logs: currentLogs,
      settings: currentSettings,
      seatDetails: currentSeatDetails
    });
    return true;
  }

  if (message.type === MessageType.START_AUTOMATION) {
    const settings: BookingSettings = message.payload?.settings || DEFAULT_SETTINGS;
    currentSettings = settings;
    currentState = AutomationState.STARTING;
    currentStatusText = `Starting automation for ${settings.fromStation} → ${settings.toStation}`;
    currentSeatDetails = undefined;
    addLog(`Command: Start Autobot (${settings.fromStation} → ${settings.toStation})`, 'info');
    broadcastStateUpdate();

    // Query active tab and send start command to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id) {
        chrome.tabs.sendMessage(activeTab.id, {
          type: MessageType.START_AUTOMATION,
          payload: { settings }
        }, () => {
          if (chrome.runtime.lastError) {
            // Tab was opened before extension startup: dynamically inject content script!
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id! },
              files: ['content/content.js']
            }).then(() => {
              setTimeout(() => {
                chrome.tabs.sendMessage(activeTab.id!, {
                  type: MessageType.START_AUTOMATION,
                  payload: { settings }
                }, () => {
                  if (chrome.runtime.lastError) {
                    // Suppress connection warning
                  }
                });
              }, 100);
            }).catch(() => {
              addLog(`Content script connection note: Ensure you are on eticket.railway.gov.bd and refresh the page (F5).`, 'warning');
            });
          }
        });
      }
    });

    sendResponse({ success: true });
    return true;
  }

  if (message.type === MessageType.STOP_AUTOMATION) {
    currentState = AutomationState.IDLE;
    currentStatusText = 'Automation stopped by user';
    addLog('Command: Stop Autobot', 'warning');
    broadcastStateUpdate();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: MessageType.STOP_AUTOMATION }, () => {
          if (chrome.runtime.lastError) {
            // Suppress error
          }
        });
      }
    });

    sendResponse({ success: true });
    return true;
  }

  if (message.type === MessageType.STATE_UPDATED && message.payload) {
    if (message.payload.state) currentState = message.payload.state;
    if (message.payload.statusText) currentStatusText = message.payload.statusText;
    if (message.payload.seatDetails) currentSeatDetails = message.payload.seatDetails;
    broadcastStateUpdate();
  }
});


