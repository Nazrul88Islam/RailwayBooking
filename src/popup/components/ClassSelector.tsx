import React from 'react';
import { SEAT_CLASSES } from '../../shared/constants';

interface ClassSelectorProps {
  value: string;
  onChange: (val: string) => void;
  error?: string;
}

export const ClassSelector: React.FC<ClassSelectorProps> = ({
  value,
  onChange,
  error
}) => {
  return (
    <div className="form-group">
      <label className="form-label">Seat Class</label>
      <select
        className="form-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {SEAT_CLASSES.map(cls => (
          <option key={cls.id} value={cls.id}>
            {cls.name}
          </option>
        ))}
      </select>
      {error && <div className="validation-error">⚠ {error}</div>}
    </div>
  );
};
