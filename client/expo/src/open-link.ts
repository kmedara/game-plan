/**
 * The only way the app opens a link outside itself.
 *
 * Every link goes through {@link isSafeLink} first, so a `javascript:` or
 * `data:` URL, from the API or built from a person's text, is refused rather
 * than run in the page or handed to another app.
 */

import { isSafeLink } from '@gameplan/rules';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

/** Thrown when a link is refused. */
export const UNSAFE_LINK = 'unsafe_link';

const assertSafe = (url: string, schemes?: readonly string[]): void => {
  if (!isSafeLink(url, schemes)) throw new Error(UNSAFE_LINK);
};

/**
 * Opens a link in the app that handles it: the browser, mail, phone, messages, or a calendar.
 *
 * @param url - The link.
 * @throws `unsafe_link` when the scheme is not allowed.
 */
export const openLink = async (url: string): Promise<void> => {
  assertSafe(url);
  await Linking.openURL(url);
};

/**
 * Opens an `https` page in the in-app browser.
 *
 * @param url - The page.
 * @throws `unsafe_link` when the link is not `https`.
 */
export const openInBrowser = async (url: string): Promise<void> => {
  assertSafe(url, ['https:']);
  await WebBrowser.openBrowserAsync(url);
};

/**
 * Sends this tab to an `https` page, as the website does for Stripe.
 *
 * @param url - The page.
 * @throws `unsafe_link` when the link is not `https`.
 */
export const navigateTab = (url: string): void => {
  assertSafe(url, ['https:']);
  window.location.assign(url);
};

/**
 * Opens an `https` page in an auth session that ends on `returnLink`.
 *
 * @param url - The page.
 * @param returnLink - The deep link that closes the session.
 * @returns The browser result.
 * @throws `unsafe_link` when the link is not `https`.
 */
export const openAuthSession = (
  url: string,
  returnLink: string,
): ReturnType<typeof WebBrowser.openAuthSessionAsync> => {
  assertSafe(url, ['https:']);
  return WebBrowser.openAuthSessionAsync(url, returnLink);
};
