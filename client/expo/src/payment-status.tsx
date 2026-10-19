/**
 * Shared pieces for the payments and dues screens.
 */

import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DueStatus } from '@gameplan/types';
import { colors } from './theme';

/** Error codes from the payments API, by translation key. */
export const PAYMENT_ERRORS = {
  payments_not_enabled: 'errors.payments.notEnabled',
  payments_not_configured: 'errors.payments.notConfigured',
  member_not_on_team: 'errors.payments.memberNotOnTeam',
  paid_in_app: 'errors.payments.paidInApp',
  due_settled: 'errors.payments.alreadyPaid',
  not_payer: 'errors.payments.notPayer',
} as const;

/**
 * Whether a due still needs paying.
 *
 * @param status - The due status.
 * @returns `true` for unpaid, pending, and refunded.
 */
export const isOwed = (status: DueStatus): boolean =>
  status === 'unpaid' || status === 'pending' || status === 'refunded';

/** Status text, red while money is still owed. */
export const DueStatusLabel = ({ status }: { status: DueStatus }) => {
  const { t } = useTranslation();
  return (
    <Text className="text-sm font-semibold" style={{ color: isOwed(status) ? colors.danger : colors.muted }}>
      {t(`payments.status.${status}`)}
    </Text>
  );
};
