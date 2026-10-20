/**
 * Landing for the `gameplan://billing` deep link when the app was not already
 * waiting for it, such as after the phone closed the app during checkout.
 */

import { Redirect, useLocalSearchParams } from 'expo-router';

export default function BillingReturn() {
  const { teamId, orgId } = useLocalSearchParams<{ teamId?: string; orgId?: string }>();
  if (orgId !== undefined && orgId.length > 0) {
    return <Redirect href={{ pathname: '/orgs/[orgId]', params: { orgId } }} />;
  }
  if (teamId !== undefined && teamId.length > 0) {
    return <Redirect href={{ pathname: '/teams/[teamId]', params: { teamId } }} />;
  }
  return <Redirect href="/plans" />;
}
