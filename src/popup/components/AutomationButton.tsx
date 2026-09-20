import React from 'react';
import { Play, Square, Pause, RotateCw } from 'lucide-react';
import { AutomationState } from '../../shared/types';

interface AutomationButtonProps {
  state: AutomationState;
  onStart: () => void;
  onStop: () => void;
  onPause?: () => void;
  onResume?: () => void;
  disabled?: boolean;
}

export const AutomationButton: React.FC<AutomationButtonProps> = ({
  state,
  onStart,
  onStop,
  disabled = false
}) => {
  const isRunning = state !== AutomationState.IDLE &&
                    state !== AutomationState.CONFIGURED &&
                    state !== AutomationState.COMPLETED &&
                    state !== AutomationState.ERROR;

  if (isRunning) {
    return (
      <button
        type="button"
        className="autobot-btn stop"
        onClick={onStop}
        disabled={disabled}
      >
        <Square size={16} fill="white" />
        STOP AUTOBOT
      </button>
    );
  }

  return (
    <button
      type="button"
      className="autobot-btn start"
      onClick={onStart}
      disabled={disabled}
    >
      <Play size={16} fill="white" />
      START AUTOBOT
    </button>
  );
};
