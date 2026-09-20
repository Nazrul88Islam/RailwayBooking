import React from 'react';
import { SeatMode } from '../../shared/types';

interface SeatModeSelectorProps {
  seatCount: number;
  seatMode: SeatMode;
  allowFallback: boolean;
  onChangeMode: (count: number, mode: SeatMode) => void;
  onToggleFallback: (fallback: boolean) => void;
}

interface OptionItem {
  id: string;
  label: string;
  count: number;
  mode: SeatMode;
}

const SEAT_OPTIONS: OptionItem[] = [
  { id: '1_single', label: '1 Seat', count: 1, mode: 'single' },
  { id: '2_adjacent', label: '2 Seats (Adjacent Pair)', count: 2, mode: 'adjacent' },
  { id: '3_adjacent', label: '3 Seats (Adjacent)', count: 3, mode: 'adjacent' },
  { id: '4_adjacent', label: '4 Seats (Adjacent)', count: 4, mode: 'adjacent' },
  { id: '2_face', label: '2 Seats (Face-to-Face)', count: 2, mode: 'face_to_face' },
  { id: '3_best', label: '3 Seats (Best Available)', count: 3, mode: 'best_available' },
  { id: '4_best', label: '4 Seats (Best Available)', count: 4, mode: 'best_available' }
];

export const SeatModeSelector: React.FC<SeatModeSelectorProps> = ({
  seatCount,
  seatMode,
  allowFallback,
  onChangeMode,
  onToggleFallback
}) => {
  const currentKey = `${seatCount}_${seatMode}`;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = SEAT_OPTIONS.find(opt => opt.id === e.target.value);
    if (selected) {
      onChangeMode(selected.count, selected.mode);
    }
  };

  return (
    <div className="form-group">
      <label className="form-label">Number of Seats / Mode</label>
      <select
        className="form-select"
        value={currentKey}
        onChange={handleChange}
      >
        {SEAT_OPTIONS.map(opt => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>

      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={allowFallback}
          onChange={(e) => onToggleFallback(e.target.checked)}
          style={{ accentColor: 'var(--accent-cyan)' }}
        />
        Allow smart fallback if exact layout is unavailable
      </label>
    </div>
  );
};
