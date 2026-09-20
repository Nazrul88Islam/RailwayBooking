import React, { useState, useRef, useEffect } from 'react';
import { STATIONS } from '../../shared/constants';
import { Station } from '../../shared/types';
import { X } from 'lucide-react';

interface StationInputProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  error?: string;
}

export const StationInput: React.FC<StationInputProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Select station...',
  error
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(value);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSearchTerm(value);
  }, [value]);

  const filteredStations = STATIONS.filter(st =>
    st.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (st.code && st.code.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (st: Station) => {
    onChange(st.name);
    setSearchTerm(st.name);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchTerm('');
    setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % (filteredStations.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredStations.length) % (filteredStations.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredStations[selectedIndex]) {
        handleSelect(filteredStations[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="form-group autocomplete-container" ref={containerRef}>
      <label className="form-label">{label}</label>
      <div className="input-with-icon">
        <input
          type="text"
          className="form-input"
          value={searchTerm}
          placeholder={placeholder}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            onChange(e.target.value);
            setIsOpen(true);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        {searchTerm && (
          <X size={14} className="input-icon" style={{ cursor: 'pointer', pointerEvents: 'auto' }} onClick={handleClear} />
        )}
      </div>

      {isOpen && filteredStations.length > 0 && (
        <div className="autocomplete-dropdown">
          {filteredStations.map((st, idx) => (
            <div
              key={st.id}
              className={`autocomplete-item ${idx === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleSelect(st)}
            >
              <span>{st.name}</span>
              {st.code && <span style={{ fontSize: '10px', opacity: 0.6 }}>{st.code}</span>}
            </div>
          ))}
        </div>
      )}

      {error && <div className="validation-error">⚠ {error}</div>}
    </div>
  );
};
