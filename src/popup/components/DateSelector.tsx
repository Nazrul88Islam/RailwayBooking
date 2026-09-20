import React from 'react';
import { QuickDateButtons } from './QuickDateButtons';
import { Calendar } from 'lucide-react';

interface DateSelectorProps {
  value: string;
  onChange: (dateStr: string) => void;
  error?: string;
}

export const DateSelector: React.FC<DateSelectorProps> = ({
  value,
  onChange,
  error
}) => {
  return (
    <div className="form-group">
      <label className="form-label">Date of Journey</label>
      <div className="input-with-icon">
        <input
          type="date"
          className="form-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Calendar size={14} className="input-icon" />
      </div>

      <QuickDateButtons selectedDate={value} onSelectDate={onChange} />

      {error && <div className="validation-error">⚠ {error}</div>}
    </div>
  );
};
