/**
 * The signed-in menu follows the team list, including one restored from cache.
 */

import { render, screen } from '@testing-library/react-native';
import MainLayout from '../app/(main)/_layout';

const mockApp = {
  api: {
    isAuthenticated: () => true,
    ensureSession: jest.fn(async () => true),
    user: { userId: 'u1', accountKind: 'adult' as const },
  },
  brand: {
    stops: ['#111111', '#222222'] as const,
    onPrimary: '#ffffff',
    primary: '#111111',
  },
  brandTeam: undefined as { name?: string; theme?: { logoKey?: string }; teamId?: string } | undefined,
  live: { connect: jest.fn(), subscribe: () => () => undefined },
  teams: [] as { teamId: string; name: string }[],
};

jest.mock('expo-router', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Redirect: () => null,
    Slot: () => <View />,
    usePathname: () => '/schedule',
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  };
});

jest.mock('@tanstack/react-query', () => ({
  useIsRestoring: () => false,
  useQueryClient: () => ({}),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/src/state', () => ({
  useApp: () => mockApp,
}));

jest.mock('@/src/use-live-query-sync', () => ({
  useLiveQuerySync: () => undefined,
}));

jest.mock('@/src/query-client', () => ({
  adoptCacheOwner: jest.fn(async () => undefined),
}));

jest.mock('@/src/media', () => ({
  useDownloadUrl: () => undefined,
}));

jest.mock('@/src/team-access', () => ({
  useTeamsWithPermission: () => [],
}));

describe('signed-in menu', () => {
  beforeEach(() => {
    mockApp.teams = [];
    mockApp.api.ensureSession.mockClear();
  });

  it('shows schedule and chats when the restored team list has a membership', async () => {
    mockApp.teams = [{ teamId: 't1', name: 'Pigs' }];
    render(<MainLayout />);
    expect(await screen.findByText('nav.schedule')).toBeTruthy();
    expect(screen.getByText('nav.chats')).toBeTruthy();
    expect(screen.getByText('nav.team')).toBeTruthy();
    expect(screen.getByText('nav.profile')).toBeTruthy();
  });

  it('names the teams tab in the plural once there is more than one team', async () => {
    mockApp.teams = [
      { teamId: 't1', name: 'Pigs' },
      { teamId: 't2', name: 'Hawks' },
    ];
    render(<MainLayout />);
    expect(await screen.findByText('nav.teams')).toBeTruthy();
    expect(screen.queryByText('nav.team')).toBeNull();
  });

  it('keeps schedule and chats off the menu when the athlete has no teams', async () => {
    render(<MainLayout />);
    expect(await screen.findByText('nav.teams')).toBeTruthy();
    expect(screen.getByText('nav.profile')).toBeTruthy();
    expect(screen.queryByText('nav.schedule')).toBeNull();
    expect(screen.queryByText('nav.chats')).toBeNull();
  });
});
