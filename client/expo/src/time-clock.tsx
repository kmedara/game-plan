/**
 * Web clock input. The value is minutes from midnight.
 */

import { clockFromMinutes } from './schedule-calendar';
import { colors } from './theme';

export const TimeClock = ({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  onDismiss?: () => void;
}) => (
  <input
    type="time"
    value={clockFromMinutes(minutes)}
    onChange={(event) => {
      const [hour, minute] = event.currentTarget.value.split(':').map(Number);
      if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) return;
      onChange(hour * 60 + minute);
    }}
    style={{
      width: '100%',
      borderRadius: 8,
      border: `1px solid ${colors.line}`,
      backgroundColor: colors.paper,
      padding: '8px 12px',
      fontSize: 16,
      color: colors.ink,
    }}
  />
);
