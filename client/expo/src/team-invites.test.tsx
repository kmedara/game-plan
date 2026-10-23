/**
 * Email and text invites go out from GamePlan, and open the person's own app
 * only while the server cannot send on that channel.
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
  isSafeLink: jest.requireActual('@gameplan/rules').isSafeLink,
}));

const mockCreateInvite = jest.fn();
const mockSendInvite = jest.fn();

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/src/state', () => ({
  useApp: () => ({
    api: {
      createInvite: (...args: unknown[]) => mockCreateInvite(...args),
      sendInvite: (...args: unknown[]) => mockSendInvite(...args),
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
    mockSendInvite.mockReset();
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

  it('has GamePlan email the invite and says where it went', async () => {
    mockSendInvite.mockResolvedValue({ channel: 'email', code: 'coach-code', role: 'coach' });
    renderInvites();
    fireEvent.press(screen.getByText('role.coach'));
    fireEvent.changeText(screen.getByLabelText('teamAdmin.email'), ' player@example.com ');
    fireEvent.press(screen.getByText('teamAdmin.emailInvite'));
    await waitFor(() =>
      expect(mockSendInvite).toHaveBeenCalledWith('team-1', {
        channel: 'email',
        to: 'player@example.com',
        role: 'coach',
        locale: 'en',
      }),
    );
    expect(await screen.findByText('teamAdmin.inviteEmailed')).toBeTruthy();
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(mockCreateInvite).not.toHaveBeenCalled();
  });

  it('has GamePlan text the invite to the number in E.164', async () => {
    mockSendInvite.mockResolvedValue({ channel: 'text', code: 'player-code', role: 'player' });
    renderInvites();
    fireEvent.changeText(screen.getByLabelText('teamAdmin.phone'), '(202) 555-0123');
    fireEvent.press(screen.getByText('teamAdmin.textInvite'));
    await waitFor(() =>
      expect(mockSendInvite).toHaveBeenCalledWith('team-1', expect.objectContaining({ channel: 'text', to: '+12025550123' })),
    );
    expect(await screen.findByText('teamAdmin.inviteTexted')).toBeTruthy();
  });

  it('shows the daily limit sentence', async () => {
    mockSendInvite.mockRejectedValue(new Error('invite_send_limit'));
    const { onError } = renderInvites();
    fireEvent.changeText(screen.getByLabelText('teamAdmin.email'), 'player@example.com');
    fireEvent.press(screen.getByText('teamAdmin.emailInvite'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('errors.teamAdmin.inviteSendLimit'));
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('opens a mailto link while GamePlan cannot send email yet', async () => {
    mockSendInvite.mockRejectedValue(new Error('email_not_configured'));
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

  it('opens an sms link while GamePlan cannot text yet', async () => {
    mockSendInvite.mockRejectedValue(new Error('text_not_configured'));
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
