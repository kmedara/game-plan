/**
 * Landing for the `gameplan://billing` deep link when the app was not already
 * waiting for it, such as after the phone closed the app during checkout.
 */

import { Redirect, useLocalSearchParams } from 'expo-router';

export default function BillingReturn() {
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  if (teamId !== undefined && teamId.length > 0) {
    return <Redirect href={{ pathname: '/teams/[teamId]', params: { teamId } }} />;
  }
  return <Redirect href="/plans" />;
}
