/**
 * Opens a hosted Stripe page: onboarding for staff, Checkout for payers.
 *
 * On a phone it opens in an in-app browser that closes itself when Stripe sends
 * the browser to the `gameplan://payments` deep link. On the web the tab goes to
 * Stripe and comes back to `/dues` or the team's payments page.
 */

import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

/** Deep link the API sends the in-app browser to when a dues page is done. */
export const PAYMENTS_RETURN_LINK = 'gameplan://payments';

/** Deep link the API sends the in-app browser to when a plan checkout or the billing portal is done. */
export const BILLING_RETURN_LINK = 'gameplan://billing';

/**
 * Sends the person to a Stripe page and waits for them to come back.
 *
 * @param url - The hosted page URL from the API.
 * @param returnLink - The deep link that ends the in-app browser session.
 * @returns The `result` the API reported, such as `success` or `subscribed`, when known.
 */
export const openStripePage = async (url: string, returnLink = PAYMENTS_RETURN_LINK): Promise<string | undefined> => {
  if (Platform.OS === 'web') {
    window.location.assign(url);
    return undefined;
  }
  const result = await WebBrowser.openAuthSessionAsync(url, returnLink);
  if (result.type !== 'success') return undefined;
  return new URL(result.url).searchParams.get('result') ?? undefined;
};
