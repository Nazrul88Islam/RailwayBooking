import React from 'react';
import { Train } from 'lucide-react';

export const Header: React.FC = () => {
  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="brand-icon">
          <Train size={18} />
        </div>
        <h1>Railway Ticket Booking Tools</h1>
      </div>
    </header>
  );
};
