import React from 'react';
import { Settings } from 'lucide-react';
import { StationInput } from './StationInput';
import { DateSelector } from './DateSelector';
import { TrainInput } from './TrainInput';
import { ClassSelector } from './ClassSelector';
import { SeatModeSelector } from './SeatModeSelector';
import { ActionDelaySelector } from './ActionDelaySelector';
import { BookingSettings, SeatMode } from '../../shared/types';

interface JourneySettingsProps {
  settings: BookingSettings;
  onChangeSettings: (newSettings: BookingSettings) => void;
  errors: Record<string, string>;
}

export const JourneySettings: React.FC<JourneySettingsProps> = ({
  settings,
  onChangeSettings,
  errors
}) => {
  const update = (patch: Partial<BookingSettings>) => {
    onChangeSettings({ ...settings, ...patch });
  };

  return (
    <div className="settings-card">
      <div className="card-title">
        <Settings size={14} />
        <span>JOURNEY & TRAIN SETTINGS</span>
      </div>

      {/* From / To Stations */}
      <div className="form-row">
        <StationInput
          label="From Station"
          value={settings.fromStation}
          onChange={(val) => update({ fromStation: val })}
          error={errors.fromStation}
        />
        <StationInput
          label="To Station"
          value={settings.toStation}
          onChange={(val) => update({ toStation: val })}
          error={errors.toStation}
        />
      </div>

      {/* Journey Date */}
      <DateSelector
        value={settings.journeyDate}
        onChange={(val) => update({ journeyDate: val })}
        error={errors.journeyDate}
      />

      {/* Target Train & Seat Class */}
      <div className="form-row">
        <TrainInput
          value={settings.targetTrain}
          onChange={(val) => update({ targetTrain: val })}
          error={errors.targetTrain}
        />
        <ClassSelector
          value={settings.seatClass}
          onChange={(val) => update({ seatClass: val })}
          error={errors.seatClass}
        />
      </div>

      {/* Seat Count & Mode */}
      <SeatModeSelector
        seatCount={settings.seatCount}
        seatMode={settings.seatMode}
        allowFallback={settings.allowFallback}
        onChangeMode={(count, mode) => update({ seatCount: count, seatMode: mode })}
        onToggleFallback={(fb) => update({ allowFallback: fb })}
      />

      {/* Action Delay / Human-Like Pacing */}
      <ActionDelaySelector
        value={settings.actionDelay}
        onChange={(val) => update({ actionDelay: val })}
      />
    </div>
  );
};
