/**
 * Login screen shows the sign-in heading.
 */

import { render, screen } from '@testing-library/react-native';
import LoginScreen from '../app/login';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
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
      user: undefined,
    },
    live: { connect: jest.fn() },
  }),
}));

jest.mock('@/src/push', () => ({
  registerPush: jest.fn(),
}));

describe('login screen', () => {
  it('renders the sign-in heading', () => {
    render(<LoginScreen />);
    expect(screen.getByText('Sign in')).toBeTruthy();
  });
});
