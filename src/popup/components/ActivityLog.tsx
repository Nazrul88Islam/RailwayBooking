import React, { useState } from 'react';
import { LogItem } from '../../shared/types';
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';

interface ActivityLogProps {
  logs: LogItem[];
  onClear?: () => void;
}

export const ActivityLog: React.FC<ActivityLogProps> = ({ logs }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (logs.length === 0) return null;

  return (
    <div className="activity-panel">
      <div className="activity-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Terminal size={12} color="var(--accent-cyan)" />
          <span>ACTIVITY LOG ({logs.length})</span>
        </div>
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>

      {isExpanded && (
        <div className="activity-list">
          {logs.slice(-15).reverse().map((item) => (
            <div key={item.id} className={`log-item ${item.type}`}>
              <span className="time">[{item.timestamp}]</span>
              <span className="msg">{item.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
