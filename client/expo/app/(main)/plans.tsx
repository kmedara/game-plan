/**
 * Legacy `/plans` URL — sends people to plans under a team.
 */

import { Redirect, useLocalSearchParams } from 'expo-router';
import { useTeamsWithPermission } from '@/src/team-access';
import { useApp } from '@/src/state';

export default function PlansRedirect() {
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  const { teams } = useApp();
  const billable = useTeamsWithPermission('manage_billing');
  const target =
    teamId !== undefined && teams.some((item) => item.teamId === teamId)
      ? teamId
      : (billable[0]?.teamId ?? teams[0]?.teamId);
  if (target === undefined) return <Redirect href="/teams" />;
  return <Redirect href={{ pathname: '/teams/[teamId]/plans', params: { teamId: target } }} />;
}
