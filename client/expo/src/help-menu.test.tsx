/**
 * The help menu opens account deletion without deleting, and a deleted account leaves the app.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { HelpButton } from './help-menu';

const mockDeleteAccount = jest.fn();
const mockDisconnect = jest.fn();
const mockReplace = jest.fn();
const mockClearPersistedCache = jest.fn(async () => undefined);

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('./query-client', () => ({
  clearPersistedCache: () => mockClearPersistedCache(),
}));

jest.mock('./state', () => ({
  useApp: () => ({
    api: { deleteAccount: () => mockDeleteAccount() },
    live: { disconnect: () => mockDisconnect() },
    brand: { primary: '#0a6e38', onPrimary: '#ffffff', secondary: '#0a6e38' },
  }),
}));

describe('help menu', () => {
  beforeEach(() => {
    mockDeleteAccount.mockReset();
    mockDisconnect.mockReset();
    mockReplace.mockReset();
    mockClearPersistedCache.mockClear();
  });

  it('opens account deletion without deleting, then signs out on confirm', async () => {
    mockDeleteAccount.mockResolvedValue(undefined);
    render(<HelpButton color="#ffffff" />);

    fireEvent.press(screen.getByLabelText('help.title'));
    fireEvent.press(screen.getByText('account.delete'));
    expect(screen.getByText('account.deleteTitle')).toBeTruthy();
    expect(mockDeleteAccount).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('account.deleteConfirm'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockClearPersistedCache).toHaveBeenCalled();
  });
});
