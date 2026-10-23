/**
 * The app opens only allowed links, whatever builds them.
 */

import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import { openAuthSession, openInBrowser, openLink } from './open-link';

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })),
  openBrowserAsync: jest.fn(async () => ({ type: 'opened' })),
}));

describe('open-link', () => {
  beforeEach(() => {
    // jest-expo already mocks `Linking.openURL`, so the spy is that mock and keeps earlier calls.
    jest.clearAllMocks();
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens web, mail, phone, text, and calendar links', async () => {
    for (const url of ['https://example.com', 'mailto:a@example.com', 'tel:+12025550123', 'sms:+12025550123', 'webcal://example.com/a.ics']) {
      await openLink(url);
      expect(Linking.openURL).toHaveBeenLastCalledWith(url);
    }
  });

  it('refuses script and data links without opening anything', async () => {
    await expect(openLink('javascript:alert(1)')).rejects.toThrow('unsafe_link');
    await expect(openLink('data:text/html,hi')).rejects.toThrow('unsafe_link');
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('keeps the in-app browser and auth sessions to https', async () => {
    await openInBrowser('https://maps.google.com/?q=field');
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://maps.google.com/?q=field');
    await expect(openInBrowser('mailto:a@example.com')).rejects.toThrow('unsafe_link');
    expect(() => openAuthSession('http://checkout.example.com', 'gameplan://payments')).toThrow('unsafe_link');
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });
});
