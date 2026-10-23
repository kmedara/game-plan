/**
 * Login screen shows the sign-in heading and the social sign-ins this deployment has.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import LoginScreen from '../app/login';

const mockOauthProviders = jest.fn(async (): Promise<string[]> => []);

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })),
  openBrowserAsync: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'auth.signIn' ? 'Sign in' : key),
  }),
}));

jest.mock('@/src/state', () => ({
  useApp: () => ({
    api: {
      refreshSession: jest.fn(async () => false),
      oauthProviders: () => mockOauthProviders(),
      user: undefined,
    },
    live: { connect: jest.fn() },
    brand: { primary: '#0a6e38', onPrimary: '#ffffff', secondary: '#0a6e38', accent: '#0a6e38', stops: ['#0a6e38', '#064e28'] },
  }),
}));

jest.mock('@/src/push', () => ({
  registerPush: jest.fn(),
}));

describe('login screen', () => {
  beforeEach(() => {
    mockOauthProviders.mockReset();
    mockOauthProviders.mockResolvedValue([]);
  });

  it('renders the sign-in heading', async () => {
    render(<LoginScreen />);
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(await screen.findByText('auth.continueCognito')).toBeTruthy();
    expect(screen.queryByText('auth.continueGoogle')).toBeNull();
  });

  it('offers Apple and Google when the pool has them and starts the chosen one', async () => {
    mockOauthProviders.mockResolvedValue(['apple', 'google', 'facebook']);
    render(<LoginScreen />);
    // Tests render as iOS, where the Apple slot is Apple's own native button with no text node.
    expect(await screen.findByText('auth.continueGoogle')).toBeTruthy();
    expect(screen.getByText('auth.continueEmail')).toBeTruthy();

    fireEvent.press(screen.getByText('auth.continueGoogle'));
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      expect.stringContaining('/identity/oauth/login?delivery=native&provider=google'),
      'gameplan://auth',
    );
  });
});
