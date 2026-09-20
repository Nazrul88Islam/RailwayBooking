import React, { useState, useEffect } from 'react';

export const Clock: React.FC = () => {
  const [timeStr, setTimeStr] = useState<string>('--:--:--');

  useEffect(() => {
    const updateTime = () => {
      try {
        const formatter = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Dhaka',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });
        setTimeStr(formatter.format(new Date()));
      } catch (e) {
        // Fallback formatting if Intl fails
        const d = new Date();
        setTimeStr(d.toTimeString().split(' ')[0]);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="clock-card">
      <div className="clock-digits">{timeStr}</div>
      <div className="clock-subtitle">BANGLADESH STANDARD TIME (BST)</div>
    </div>
  );
};
