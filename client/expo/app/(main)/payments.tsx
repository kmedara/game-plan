/**
 * Landing for the `gameplan://payments` deep link when the app was not already
 * waiting for it, such as after the phone closed the app during checkout.
 */

import { Redirect, useLocalSearchParams } from 'expo-router';

export default function PaymentsReturn() {
  const { result, teamId } = useLocalSearchParams<{ result?: string; teamId?: string }>();
  const onboarding = result === 'onboarded' || result === 'refresh';
  if (onboarding && teamId !== undefined && teamId.length > 0) {
    return <Redirect href={{ pathname: '/teams/[teamId]/payments', params: { teamId } }} />;
  }
  return <Redirect href={{ pathname: '/dues', params: result !== undefined ? { result } : {} }} />;
}
