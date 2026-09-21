import React, { useState, useEffect } from 'react';
import '../popup/styles/tokens.css';
import '../popup/styles/App.css';

import { Header } from './components/Header';
import { Clock } from './components/Clock';
import { JourneySettings } from './components/JourneySettings';
import { AutomationButton } from './components/AutomationButton';
import { StatusIndicator } from './components/StatusIndicator';
import { SeatDetailsCard } from './components/SeatDetailsCard';
import { ActivityLog } from './components/ActivityLog';

import { BookingSettings, AutomationState, LogItem, SeatDetailRow } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/constants';
import { getStoredSettings, saveStoredSettings } from '../shared/storage';
import { MessageType, ExtensionMessage } from '../shared/messages';

export const App: React.FC = () => {
  const [settings, setSettings] = useState<BookingSettings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<AutomationState>(AutomationState.IDLE);
  const [statusText, setStatusText] = useState<string>('');
  const [seatDetails, setSeatDetails] = useState<SeatDetailRow[] | undefined>(undefined);
  const [logs, setLogs] = useState<LogItem[]>([
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString('en-GB'),
      message: 'Extension loaded & ready',
      type: 'info'
    }
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load stored settings on initial mount
  useEffect(() => {
    getStoredSettings().then((stored) => {
      setSettings(stored);
    });

    // Check background state if chrome runtime is available
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: MessageType.GET_STATE }, (response) => {
        if (chrome.runtime.lastError) {
          // Service worker waking up or disconnected, suppress error
          return;
        }
        if (response && response.state) {
          setState(response.state);
          if (response.statusText) setStatusText(response.statusText);
          if (response.logs) setLogs(response.logs);
          if (response.seatDetails) setSeatDetails(response.seatDetails);
        }
      });


      const messageListener = (message: ExtensionMessage) => {
        if (message.type === MessageType.STATE_UPDATED) {
          if (message.payload?.state) setState(message.payload.state);
          if (message.payload?.statusText) setStatusText(message.payload.statusText);
          if (message.payload?.logs) setLogs(message.payload.logs);
          if (message.payload?.seatDetails) setSeatDetails(message.payload.seatDetails);
        } else if (message.type === MessageType.LOG_ADDED && message.payload) {
          setLogs((prev) => [...prev, message.payload]);
        }
      };

      chrome.runtime.onMessage.addListener(messageListener);
      return () => chrome.runtime.onMessage.removeListener(messageListener);
    }
  }, []);

  // Persist settings changes
  const handleSettingsChange = (newSettings: BookingSettings) => {
    setSettings(newSettings);
    saveStoredSettings(newSettings);
    // Clear validation error if user filled missing field
    setErrors({});
  };

  const validateSettings = (): boolean => {
    const errs: Record<string, string> = {};
    if (!settings.fromStation.trim()) errs.fromStation = 'Please select origin station';
    if (!settings.toStation.trim()) errs.toStation = 'Please select destination station';
    if (settings.fromStation.trim().toLowerCase() === settings.toStation.trim().toLowerCase()) {
      errs.toStation = 'Destination must be different from origin';
    }
    if (!settings.journeyDate) errs.journeyDate = 'Please select journey date';
    if (!settings.targetTrain.trim()) errs.targetTrain = 'Please enter target train';
    if (!settings.seatClass) errs.seatClass = 'Please select seat class';

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const addLog = (message: string, type: 'info' | 'success' | 'warning' | 'error') => {
    const newLog: LogItem = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString('en-GB'),
      message,
      type
    };
    setLogs((prev) => [...prev, newLog]);
  };

  const handleStart = () => {
    if (!validateSettings()) {
      addLog('Validation failed. Please correct input fields.', 'error');
      return;
    }

    addLog(`Starting automation for ${settings.fromStation} → ${settings.toStation}`, 'info');
    setState(AutomationState.STARTING);
    setSeatDetails(undefined);

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: MessageType.START_AUTOMATION,
        payload: { settings }
      });
    } else {
      // Dev mode simulated start
      setTimeout(() => {
        setState(AutomationState.SEARCHING);
        setStatusText(`Searching ${settings.fromStation} → ${settings.toStation}`);
        addLog(`Searching ${settings.fromStation} → ${settings.toStation}...`, 'info');
      }, 1000);
    }
  };

  const handleStop = () => {
    addLog('User requested automation stop.', 'warning');
    setState(AutomationState.IDLE);
    setStatusText('Automation stopped by user');

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: MessageType.STOP_AUTOMATION });
    }
  };

  return (
    <div className="app-container">
      <Header />
      <Clock />
      
      <JourneySettings
        settings={settings}
        onChangeSettings={handleSettingsChange}
        errors={errors}
      />

      <AutomationButton
        state={state}
        onStart={handleStart}
        onStop={handleStop}
      />

      <StatusIndicator
        state={state}
        customStatus={statusText}
      />

      <SeatDetailsCard seatDetails={seatDetails} />

      <ActivityLog logs={logs} />
    </div>
  );
};

