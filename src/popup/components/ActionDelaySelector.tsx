import React from 'react';
import { DELAY_PRESETS } from '../../shared/constants';

interface ActionDelaySelectorProps {
  value: number;
  onChange: (val: number) => void;
}

export const ActionDelaySelector: React.FC<ActionDelaySelectorProps> = ({
  value,
  onChange
}) => {
  return (
    <div className="form-group">
      <label className="form-label">
        Action Delay (Human-Like Pacing)
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{value} ms</span>
      </label>
      
      <div className="presets-row">
        {DELAY_PRESETS.map(preset => {
          const isActive = value === preset.value;
          return (
            <button
              key={preset.value}
              type="button"
              className={`preset-btn ${isActive ? 'active' : ''}`}
              onClick={() => onChange(preset.value)}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="pacing-subtitle">
        ⚡ Realistic human typing + randomized delay variance applied
      </div>
    </div>
  );
};
