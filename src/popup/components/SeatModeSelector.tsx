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

/**
 * The dropdown value is ALWAYS `${count}_${mode}` — and so is every option id (built below).
 * Hand-written ids drifted from that ("2_face" vs "2_face_to_face"), so the dropdown could not
 * find the saved option and silently displayed "1 Seat" while the engine ran with something else.
 */
export const seatOptionId = (count: number, mode: SeatMode): string => `${Number(count)}_${mode}`;

const option = (label: string, count: number, mode: SeatMode): OptionItem => ({
  id: seatOptionId(count, mode),
  label,
  count,
  mode
});

export const SEAT_OPTIONS: OptionItem[] = [
  option('1 Seat', 1, 'single'),
  option('2 Seats (Adjacent Pair)', 2, 'adjacent'),
  option('3 Seats (Adjacent)', 3, 'adjacent'),
  option('4 Seats (Adjacent)', 4, 'adjacent'),
  option('2 Seats (Face-to-Face)', 2, 'face_to_face'),
  option('3 Seats (Best Available)', 3, 'best_available'),
  option('4 Seats (Best Available)', 4, 'best_available')
];

export const SeatModeSelector: React.FC<SeatModeSelectorProps> = ({
  seatCount,
  seatMode,
  allowFallback,
  onChangeMode,
  onToggleFallback
}) => {
  // Number(): a count restored from storage may be the string "2"
  const currentKey = seatOptionId(seatCount, seatMode);
  const isKnown = SEAT_OPTIONS.some(opt => opt.id === currentKey);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = SEAT_OPTIONS.find(opt => opt.id === e.target.value);
    if (selected) {
      onChangeMode(selected.count, selected.mode);
    }
  };

  // 3-4 seats "side by side" cannot exist in a 2 + 2 chair car (an aisle splits every row)
  const multiAdjacent = seatMode === 'adjacent' && Number(seatCount) >= 3;

  return (
    <div className="form-group">
      <label className="form-label">Number of Seats / Mode</label>
      <select
        className="form-select"
        value={currentKey}
        onChange={handleChange}
      >
        {/* A saved combination that is not in the list is shown honestly instead of as "1 Seat" */}
        {!isKnown && (
          <option value={currentKey} disabled>
            {`Custom: ${seatCount} seat(s) — ${seatMode}`}
          </option>
        )}
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
        If the exact layout is unavailable, ask me before booking a different one
      </label>

      {multiAdjacent && (
        <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
          {allowFallback
            ? `${seatCount} seats side by side only exist in 3-per-row coaches (e.g. AC_S). In 2 + 2 chair cars the bot will ask you before taking the closest match, e.g. a whole row across the aisle.`
            : `Not asking is on: ${seatCount} seats side by side only exist in 3-per-row coaches (e.g. AC_S). In 2 + 2 chair cars (S_CHAIR, SNIGDHA…) nothing will be booked.`}
        </div>
      )}
    </div>
  );
};
