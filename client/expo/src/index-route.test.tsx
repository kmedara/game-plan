/**
 * The root route skips the refresh request when no session can restore.
 */

import { render, screen } from '@testing-library/react-native';
import Index from '../app/index';

const mockApi = {
  mightHaveSession: jest.fn<Promise<boolean>, []>(),
  refreshSession: jest.fn<Promise<boolean>, []>(),
  ensureSession: jest.fn<Promise<boolean>, []>(),
  user: undefined as { needsProfileCompletion?: boolean } | undefined,
};

jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
  };
});

jest.mock('@/src/state', () => ({
  useApp: () => ({ api: mockApi }),
}));

describe('index route', () => {
  beforeEach(() => {
    mockApi.mightHaveSession.mockReset();
    mockApi.refreshSession.mockReset();
    mockApi.ensureSession.mockReset();
  });

  it('goes to login without a refresh request when there is no session hint', async () => {
    mockApi.mightHaveSession.mockResolvedValue(false);
    render(<Index />);
    expect(await screen.findByText('redirect:/login')).toBeTruthy();
    expect(mockApi.ensureSession).not.toHaveBeenCalled();
  });

  it('restores the session when the hint is present', async () => {
    mockApi.mightHaveSession.mockResolvedValue(true);
    mockApi.ensureSession.mockResolvedValue(true);
    render(<Index />);
    expect(await screen.findByText('redirect:/schedule')).toBeTruthy();
    expect(mockApi.ensureSession).toHaveBeenCalledTimes(1);
  });

  it('goes to login when the hinted session no longer refreshes', async () => {
    mockApi.mightHaveSession.mockResolvedValue(true);
    mockApi.ensureSession.mockResolvedValue(false);
    render(<Index />);
    expect(await screen.findByText('redirect:/login')).toBeTruthy();
  });
});
