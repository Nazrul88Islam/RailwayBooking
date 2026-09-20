import React from 'react';

interface QuickDateButtonsProps {
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
}

// Utility to get YYYY-MM-DD in Bangladesh Standard Time + offset days
const getBDDateWithOffset = (offsetDays: number): string => {
  const now = new Date();
  // Get BD time string formatted as YYYY-MM-DD
  const bdTimeStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const [year, month, day] = bdTimeStr.split('-').map(Number);
  const bdDate = new Date(year, month - 1, day);
  bdDate.setDate(bdDate.getDate() + offsetDays);

  const yyyy = bdDate.getFullYear();
  const mm = String(bdDate.getMonth() + 1).padStart(2, '0');
  const dd = String(bdDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const QuickDateButtons: React.FC<QuickDateButtonsProps> = ({
  selectedDate,
  onSelectDate
}) => {
  const options = [
    { label: 'Today', offset: 0 },
    { label: 'Tomorrow', offset: 1 },
    { label: '+2 Days', offset: 2 },
    { label: '+3 Days', offset: 3 },
    { label: '+4 Days', offset: 4 },
    { label: '+5 Days', offset: 5 },
    { label: '+6 Days', offset: 6 },
    { label: '+7 Days', offset: 7 },
    { label: '+10 Days', offset: 10 }
  ];

  return (
    <div className="quick-dates-grid">
      {options.map(opt => {
        const dateVal = getBDDateWithOffset(opt.offset);
        const isActive = selectedDate === dateVal;
        return (
          <button
            key={opt.label}
            type="button"
            className={`quick-date-btn ${isActive ? 'active' : ''}`}
            onClick={() => onSelectDate(dateVal)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};
