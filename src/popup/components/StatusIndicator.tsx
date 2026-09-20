import React from 'react';
import { AutomationState } from '../../shared/types';

interface StatusIndicatorProps {
  state: AutomationState;
  customStatus?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  state,
  customStatus
}) => {
  let dotClass = 'ready';
  let statusText = customStatus || '● Works automatically from Home or Search Results page';

  switch (state) {
    case AutomationState.IDLE:
    case AutomationState.CONFIGURED:
      dotClass = 'ready';
      statusText = customStatus || '● Ready - Works automatically from Home or Search Results page';
      break;
    case AutomationState.WAITING_FOR_BOOKING_TIME:
      dotClass = 'warning';
      statusText = customStatus || '● Waiting for target booking time...';
      break;
    case AutomationState.CAPTCHA_REQUIRED:
      dotClass = 'error';
      statusText = '● CAPTCHA detected — Please solve manually!';
      break;
    case AutomationState.OTP_REQUIRED:
      dotClass = 'warning';
      statusText = '● OTP verification required — Please enter manually!';
      break;
    case AutomationState.PAYMENT_REQUIRED:
      dotClass = 'ready';
      statusText = '● Payment page reached — Please complete payment manually!';
      break;
    case AutomationState.COMPLETED:
      dotClass = 'ready';
      statusText = '● Booking workflow completed successfully!';
      break;
    case AutomationState.ERROR:
      dotClass = 'error';
      statusText = customStatus || '● Automation error encountered';
      break;
    default:
      dotClass = 'running';
      statusText = customStatus || `● Running (${state.toLowerCase().replace(/_/g, ' ')})`;
      break;
  }

  return (
    <div className="status-bar">
      <div className={`status-dot ${dotClass}`} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {statusText}
      </span>
    </div>
  );
};
