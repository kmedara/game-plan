/**
 * The public privacy page renders the policy, in English and Spanish alike.
 */

import { render, screen } from '@testing-library/react-native';
import PrivacyScreen from '../app/privacy';
import { PRIVACY_POLICY, policyFor } from './privacy-policy';

const mockConfig = { supportEmail: '' };
let mockLanguage = 'en';

jest.mock('./config', () => ({
  get config() {
    return mockConfig;
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => false, replace: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: mockLanguage } }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('privacy page', () => {
  beforeEach(() => {
    mockLanguage = 'en';
    mockConfig.supportEmail = '';
  });

  it('keeps the English and Spanish policies in step', () => {
    expect(PRIVACY_POLICY.es.sections.map((section) => section.bullets?.length ?? 0)).toEqual(
      PRIVACY_POLICY.en.sections.map((section) => section.bullets?.length ?? 0),
    );
    expect(PRIVACY_POLICY.es.sections.map((section) => section.body.length)).toEqual(
      PRIVACY_POLICY.en.sections.map((section) => section.body.length),
    );
    expect(policyFor('es-MX')).toBe(PRIVACY_POLICY.es);
    expect(policyFor('fr')).toBe(PRIVACY_POLICY.en);
  });

  it('shows every section, and the contact line only with an address', () => {
    render(<PrivacyScreen />);
    for (const section of PRIVACY_POLICY.en.sections) expect(screen.getByText(section.title)).toBeTruthy();
    expect(screen.queryByText(/privacy@/u)).toBeNull();

    mockConfig.supportEmail = 'privacy@example.com';
    render(<PrivacyScreen />);
    expect(screen.getByText('privacy@example.com')).toBeTruthy();
  });

  it('renders in Spanish', () => {
    mockLanguage = 'es';
    render(<PrivacyScreen />);
    expect(screen.getByText('Política de privacidad')).toBeTruthy();
    expect(screen.getByText('Eliminar tu cuenta')).toBeTruthy();
  });
});
