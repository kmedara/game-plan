/**
 * Pull distance that starts a reload, and which queries that reload touches.
 */

import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { PULL_THRESHOLD, refetchOnScreen, shouldStartPullRefresh } from './pull-refresh';

describe('shouldStartPullRefresh', () => {
  it('starts when the scroller is at the top and the pull reaches the threshold', () => {
    expect(shouldStartPullRefresh({ atTop: true, pullDistance: PULL_THRESHOLD, refreshing: false })).toBe(true);
  });

  it('waits for a shorter pull', () => {
    expect(shouldStartPullRefresh({ atTop: true, pullDistance: PULL_THRESHOLD - 1, refreshing: false })).toBe(false);
  });

  it('ignores a pull that did not start at the top', () => {
    expect(shouldStartPullRefresh({ atTop: false, pullDistance: PULL_THRESHOLD + 20, refreshing: false })).toBe(false);
  });

  it('ignores a pull while a refresh is already running', () => {
    expect(shouldStartPullRefresh({ atTop: true, pullDistance: PULL_THRESHOLD + 20, refreshing: true })).toBe(false);
  });
});

describe('refetchOnScreen', () => {
  it('reloads a query a screen is showing and leaves a cached one alone', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const visible = jest.fn().mockResolvedValue('visible');
    const cached = jest.fn().mockResolvedValue('cached');
    await queryClient.fetchQuery({ queryKey: ['visible'], queryFn: visible });
    await queryClient.fetchQuery({ queryKey: ['cached'], queryFn: cached });
    const observer = new QueryObserver(queryClient, { queryKey: ['visible'], queryFn: visible });
    const unsubscribe = observer.subscribe(() => undefined);
    visible.mockClear();
    cached.mockClear();

    await refetchOnScreen(queryClient);

    expect(visible).toHaveBeenCalledTimes(1);
    expect(cached).not.toHaveBeenCalled();
    unsubscribe();
    queryClient.clear();
  });
});
