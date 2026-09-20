import React from 'react';
import { Train } from 'lucide-react';
import { APP_VERSION } from '../../shared/constants';

export const Header: React.FC = () => {
  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="brand-icon">
          <Train size={18} />
        </div>
        <h1>Railway Ticket Booking Tools</h1>
      </div>
      <div className="version-badge">
        v{APP_VERSION} Auto
      </div>
    </header>
  );
};
