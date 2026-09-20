import { BookingSettings } from './types';
import { DEFAULT_SETTINGS } from './constants';

const STORAGE_KEY = 'bd_railway_booking_settings_v2';

export const getStoredSettings = async (): Promise<BookingSettings> => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
          if (result[STORAGE_KEY]) {
            resolve({ ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] });
          } else {
            resolve(DEFAULT_SETTINGS);
          }
        });
      });
    } else {
      const local = localStorage.getItem(STORAGE_KEY);
      if (local) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(local) };
      }
    }
  } catch (err) {
    console.warn('Error reading from storage:', err);
  }
  return DEFAULT_SETTINGS;
};

export const saveStoredSettings = async (settings: BookingSettings): Promise<void> => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEY]: settings }, () => {
          resolve();
        });
      });
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  } catch (err) {
    console.warn('Error saving to storage:', err);
  }
};
