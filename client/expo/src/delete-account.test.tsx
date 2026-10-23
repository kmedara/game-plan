/**
 * Deleting an account takes a second tap, and a refusal names what to hand over.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccountDeletionBlocked } from './api';
import { DeleteAccountSection } from './delete-account';

const mockDeleteAccount = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => (values?.name === undefined ? key : `${key}:${values.name}`),
  }),
}));

jest.mock('./state', () => ({
  useApp: () => ({
    api: { deleteAccount: () => mockDeleteAccount() },
    brand: { primary: '#0a6e38', onPrimary: '#ffffff', secondary: '#0a6e38' },
  }),
}));

describe('delete account', () => {
  beforeEach(() => mockDeleteAccount.mockReset());

  it('asks again before deleting, then leaves the app', async () => {
    mockDeleteAccount.mockResolvedValue(undefined);
    const onDeleted = jest.fn(async () => undefined);
    render(<DeleteAccountSection onDeleted={onDeleted} />);

    fireEvent.press(screen.getByText('account.delete'));
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(screen.getByText('account.deleteRemoves')).toBeTruthy();

    fireEvent.press(screen.getByText('account.deleteConfirm'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('lists the organization and team to hand over', async () => {
    mockDeleteAccount.mockRejectedValue(new AccountDeletionBlocked(['Metro FC'], ['Rockets']));
    const onDeleted = jest.fn(async () => undefined);
    render(<DeleteAccountSection onDeleted={onDeleted} />);

    fireEvent.press(screen.getByText('account.delete'));
    fireEvent.press(screen.getByText('account.deleteConfirm'));

    expect(await screen.findByText('account.blockedOrg:Metro FC')).toBeTruthy();
    expect(screen.getByText('account.blockedTeam:Rockets')).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
