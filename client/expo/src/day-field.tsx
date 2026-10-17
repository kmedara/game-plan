/**
 * Web civil-date input. The value is `YYYY-MM-DD`.
 */

import { colors } from './theme';

export const DayField = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (dayKey: string) => void;
}) => (
  <input
    type="date"
    value={value}
    onChange={(event) => onChange(event.currentTarget.value)}
    style={{
      width: '100%',
      borderRadius: 12,
      border: `1px solid ${colors.line}`,
      backgroundColor: colors.inset,
      padding: '8px 12px',
      fontSize: 16,
      color: colors.ink,
    }}
  />
);
