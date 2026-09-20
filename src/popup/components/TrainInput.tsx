import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';

const POPULAR_TRAINS = [
  'PARABAT EXPRESS (709)',
  'JAYENTIKA EXPRESS (717)',
  'KALNI EXPRESS (773)',
  'UPABAN EXPRESS (739)',
  "COXS BAZAR EXPRESS (814)",
  "COX'S BAZAR EXPRESS (813)",
  'PARJOTAK EXPRESS (816)',
  'PARJOTAK EXPRESS (815)',
  'SUBARNA EXPRESS (701)',
  'MOHANAGAR EXPRESS (721)',
  'SONAR BANGLA EXPRESS (787)',
  'SILKCITY EXPRESS (753)',
  'EKOTA EXPRESS (705)',
  'PANCHAGARH EXPRESS (793)'
];

interface TrainInputProps {
  value: string;
  onChange: (val: string) => void;
  error?: string;
}

export const TrainInput: React.FC<TrainInputProps> = ({
  value,
  onChange,
  error
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = POPULAR_TRAINS.filter(t =>
    t.toLowerCase().includes(value.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="form-group autocomplete-container" ref={containerRef}>
      <label className="form-label">Target Train</label>
      <div className="input-with-icon">
        <input
          type="text"
          className="form-input"
          value={value}
          placeholder="e.g. PARABAT"
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
          }}
        />
        {value && (
          <X
            size={14}
            className="input-icon"
            style={{ cursor: 'pointer', pointerEvents: 'auto' }}
            onClick={() => onChange('')}
          />
        )}
      </div>

      {isOpen && filtered.length > 0 && (
        <div className="autocomplete-dropdown">
          {filtered.map(train => (
            <div
              key={train}
              className={`autocomplete-item ${train.toLowerCase() === value.toLowerCase() ? 'selected' : ''}`}
              onClick={() => {
                onChange(train);
                setIsOpen(false);
              }}
            >
              <span>{train}</span>
            </div>
          ))}
        </div>
      )}

      {error && <div className="validation-error">⚠ {error}</div>}
    </div>
  );
};
