/**
 * Email and text invites create the role code, then open the message.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { createTestQueryClient, queryWrapper } from './test-query';
import { TeamInvites } from './team-invites';

jest.mock('@gameplan/types', () => ({
  TEAM_ROLES: ['team_admin', 'coach', 'player', 'parent'],
}));

jest.mock('@gameplan/rules', () => ({
  callerCanGrant: () => true,
}));

const mockCreateInvite = jest.fn();

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@/src/state', () => ({
  useApp: () => ({
    api: {
      createInvite: (...args: unknown[]) => mockCreateInvite(...args),
      deleteInvite: jest.fn(),
      listInvites: jest.fn(async () => []),
    },
    brand: { primary: '#0a6e38', secondary: '#0a6e38' },
  }),
}));

const invite = (role: 'coach' | 'player', code: string) => ({
  code,
  teamId: 'team-1',
  role,
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-02-01T00:00:00.000Z',
});

const renderInvites = (onError = jest.fn()) => {
  const view = render(
    <TeamInvites teamId="team-1" teamName="Rockets" callerRole="team_admin" onError={onError} />,
    { wrapper: queryWrapper(createTestQueryClient()) },
  );
  return { ...view, onError };
};

describe('team invites', () => {
  beforeEach(() => {
    mockCreateInvite.mockReset();
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects a bad email before creating a code', () => {
    const { onError } = renderInvites();
    fireEvent.changeText(screen.getByLabelText('teamAdmin.email'), 'not-an-email');
    fireEvent.press(screen.getByText('teamAdmin.emailInvite'));
    expect(onError).toHaveBeenCalledWith('errors.teamAdmin.badInviteEmail');
    expect(mockCreateInvite).not.toHaveBeenCalled();
  });

  it('creates the selected role code and opens a mailto link', async () => {
    mockCreateInvite.mockResolvedValue(invite('coach', 'coach-code'));
    renderInvites();
    fireEvent.press(screen.getByText('role.coach'));
    fireEvent.changeText(screen.getByLabelText('teamAdmin.email'), 'player@example.com');
    fireEvent.press(screen.getByText('teamAdmin.emailInvite'));
    await waitFor(() => expect(mockCreateInvite).toHaveBeenCalledWith('team-1', 'coach'));
    await waitFor(() =>
      expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('mailto:player@example.com')),
    );
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('coach-code')));
  });

  it('creates the selected role code and opens an sms link', async () => {
    mockCreateInvite.mockResolvedValue(invite('player', 'player-code'));
    renderInvites();
    fireEvent.changeText(screen.getByLabelText('teamAdmin.phone'), '(202) 555-0123');
    fireEvent.press(screen.getByText('teamAdmin.textInvite'));
    await waitFor(() => expect(mockCreateInvite).toHaveBeenCalledWith('team-1', 'player'));
    await waitFor(() =>
      expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('sms:+12025550123')),
    );
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('player-code')));
  });
});
