import { BookingSettings, AutomationState, LogItem } from './types';

export enum MessageType {
  START_AUTOMATION = 'START_AUTOMATION',
  STOP_AUTOMATION = 'STOP_AUTOMATION',
  PAUSE_AUTOMATION = 'PAUSE_AUTOMATION',
  RESUME_AUTOMATION = 'RESUME_AUTOMATION',
  GET_STATE = 'GET_STATE',
  STATE_UPDATED = 'STATE_UPDATED',
  LOG_ADDED = 'LOG_ADDED',
  PING = 'PING',
  PONG = 'PONG'
}

export interface ExtensionMessage {
  type: MessageType;
  payload?: any;
}

export interface StartAutomationPayload {
  settings: BookingSettings;
}

export interface StateUpdatedPayload {
  state: AutomationState;
  statusText?: string;
  logs?: LogItem[];
}
