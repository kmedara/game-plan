/**
 * Opens a hosted Stripe page: onboarding for staff, Checkout for payers.
 *
 * On a phone it opens in an in-app browser that closes itself when Stripe sends
 * the browser to the `gameplan://payments` deep link. On the web the tab goes to
 * Stripe and comes back to `/dues` or the team's payments page.
 */

import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

/** Deep link the API sends the in-app browser to when Stripe is done. */
export const PAYMENTS_RETURN_LINK = 'gameplan://payments';

/**
 * Sends the person to a Stripe page and waits for them to come back.
 *
 * @param url - The hosted page URL from the API.
 * @returns `success`, `onboarded`, `cancel`, or `refresh` when known, otherwise `undefined`.
 */
export const openStripePage = async (url: string): Promise<string | undefined> => {
  if (Platform.OS === 'web') {
    window.location.assign(url);
    return undefined;
  }
  const result = await WebBrowser.openAuthSessionAsync(url, PAYMENTS_RETURN_LINK);
  if (result.type !== 'success') return undefined;
  return new URL(result.url).searchParams.get('result') ?? undefined;
};
