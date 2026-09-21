import React from 'react';
import { SeatDetailRow } from '../../shared/types';

interface SeatDetailsCardProps {
  seatDetails?: SeatDetailRow[];
}

export const SeatDetailsCard: React.FC<SeatDetailsCardProps> = ({ seatDetails }) => {
  if (!seatDetails || seatDetails.length === 0) return null;

  return (
    <div className="seat-details-card" style={{
      marginTop: '12px',
      padding: '12px',
      borderRadius: '8px',
      background: 'rgba(255, 255, 255, 0.06)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)'
    }}>
      <div style={{
        fontSize: '13px',
        fontWeight: 'bold',
        marginBottom: '8px',
        color: '#4ade80',
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }}>
        <span>🎟️</span>
        <span>Seat Details</span>
      </div>

      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '12px',
        color: '#e2e8f0',
        textAlign: 'left'
      }}>
        <thead>
          <tr style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#94a3b8',
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            <th style={{ padding: '4px 6px' }}>Class</th>
            <th style={{ padding: '4px 6px' }}>Seats</th>
            <th style={{ padding: '4px 6px', textAlign: 'right' }}>Fare</th>
          </tr>
        </thead>
        <tbody>
          {seatDetails.map((row, idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <td style={{ padding: '6px', fontWeight: 600, color: '#38bdf8' }}>{row.className}</td>
              <td style={{ padding: '6px', fontWeight: 700, color: '#facc15' }}>{row.seats}</td>
              <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600, color: '#4ade80' }}>{row.fare}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
