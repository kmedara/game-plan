/**
 * Pull-to-refresh for screen scrollers.
 *
 * iOS and Android use RefreshControl. The web control is a no-op, so a touch
 * that starts at the top and moves down refetches instead of reloading the page.
 */

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from './theme';

/**
 * Reloads every query a mounted screen is showing.
 *
 * Cached queries with no subscriber stay put. The shell does not name keys.
 *
 * @param queryClient - The signed-in cache.
 * @returns The refetch, including a screen that is still mounted underneath.
 */
export const refetchOnScreen = (queryClient: QueryClient): Promise<void> =>
  queryClient.refetchQueries({ type: 'active' });

const noopRefresh = (): Promise<unknown> => Promise.resolve();

/** Reloads the queries mounted screens are showing. Screens do not choose keys. */
const PullRefreshContext = createContext<() => Promise<unknown>>(noopRefresh);

/**
 * Supplies the pull action for screens inside the signed-in shell.
 *
 * @param children - The slot that renders the current screen.
 * @returns The screen wrapped with a reload of whatever it is showing.
 */
export const PullRefreshProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const refresh = useCallback(() => refetchOnScreen(queryClient), [queryClient]);
  return <PullRefreshContext.Provider value={refresh}>{children}</PullRefreshContext.Provider>;
};

/** Downward travel, in pixels, that starts a refresh. */
export const PULL_THRESHOLD = 64;

/**
 * A pull refreshes only when the scroller is already at the top and the finger has moved down far enough.
 *
 * @param input - Scroll position, downward distance, and whether a refresh is already running.
 * @returns Whether this gesture should reload the screen.
 */
export const shouldStartPullRefresh = (input: {
  atTop: boolean;
  pullDistance: number;
  refreshing: boolean;
}): boolean => input.atTop && !input.refreshing && input.pullDistance >= PULL_THRESHOLD;

type ScrollHost = {
  getScrollableNode?: () => HTMLElement;
  getScrollRef?: () => ScrollHost | null;
};

const scrollElement = (node: unknown): HTMLElement | null => {
  if (node === null || typeof node !== 'object') return null;
  const host = node as ScrollHost;
  const nested = host.getScrollRef?.() ?? host;
  const inner = nested.getScrollableNode?.() ?? nested;
  return inner instanceof HTMLElement ? inner : null;
};

const contained: ViewStyle | undefined =
  Platform.OS === 'web' ? ({ overscrollBehaviorY: 'contain' } as ViewStyle) : undefined;

const grown = (style: StyleProp<ViewStyle> | undefined): StyleProp<ViewStyle> =>
  style === undefined ? { flexGrow: 1 } : [{ flexGrow: 1 }, style];

/**
 * Binds a refresh promise so a second pull is ignored until the first finishes.
 *
 * @returns The refreshing flag, the control for a native list, and a ref for the scroller.
 */
const usePullRefresh = () => {
  const onRefresh = useContext(PullRefreshContext);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const hostRef = useRef<unknown>(null);
  const setHost = useCallback((node: unknown) => {
    hostRef.current = node;
  }, []);

  const run = (): void => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    void onRefreshRef.current().finally(() => {
      refreshingRef.current = false;
      setRefreshing(false);
    });
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let node: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let startY = 0;
    let tracking = false;
    let pullDistance = 0;
    const onStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (touch === undefined || node === null || node.scrollTop > 0) {
        tracking = false;
        return;
      }
      startY = touch.clientY;
      pullDistance = 0;
      tracking = true;
    };
    const onMove = (event: TouchEvent): void => {
      if (!tracking || node === null) return;
      const touch = event.touches[0];
      if (touch === undefined) return;
      const distance = touch.clientY - startY;
      if (distance > 0 && node.scrollTop <= 0) {
        event.preventDefault();
        pullDistance = distance;
        return;
      }
      pullDistance = 0;
    };
    const onEnd = (): void => {
      const distance = pullDistance;
      const atTop = node !== null && node.scrollTop <= 0;
      tracking = false;
      pullDistance = 0;
      if (shouldStartPullRefresh({ atTop, pullDistance: distance, refreshing: refreshingRef.current })) run();
    };
    const listen = (): void => {
      node = scrollElement(hostRef.current);
      if (node === null) {
        if (attempts < 10) {
          attempts += 1;
          timer = setTimeout(listen, 50);
        }
        return;
      }
      node.addEventListener('touchstart', onStart, { passive: true });
      node.addEventListener('touchmove', onMove, { passive: false });
      node.addEventListener('touchend', onEnd);
    };
    listen();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      if (node === null) return;
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', onEnd);
    };
  }, []);

  const refreshControl =
    Platform.OS === 'web' ? undefined : (
      <RefreshControl refreshing={refreshing} onRefresh={run} tintColor={colors.field} colors={[colors.field]} />
    );
  const indicator =
    Platform.OS === 'web' && refreshing ? (
      <ActivityIndicator
        color={colors.field}
        pointerEvents="none"
        style={{ position: 'absolute', top: 8, alignSelf: 'center', zIndex: 2 }}
      />
    ) : null;

  return { hostRef, setHost, refreshControl, indicator, refreshing };
};

type RefreshableScrollProps = ScrollViewProps & {
  className?: string;
  children?: ReactNode;
};

/** Scroll view that reloads the shell's current screen when pulled down. */
export const RefreshableScroll = ({
  children,
  className,
  style,
  contentContainerStyle,
  onScroll,
  ...rest
}: RefreshableScrollProps) => {
  const pull = usePullRefresh();
  return (
    <View className="flex-1" style={{ flex: 1 }}>
      {pull.indicator}
      <ScrollView
        {...rest}
        ref={pull.setHost}
        className={className}
        style={[contained, style]}
        contentContainerStyle={grown(contentContainerStyle)}
        alwaysBounceVertical
        scrollEventThrottle={16}
        refreshControl={pull.refreshControl}
        onScroll={(event) => onScroll?.(event)}
      >
        {children}
      </ScrollView>
    </View>
  );
};

export type PullRefreshListProps = {
  ref: (node: unknown) => void;
  alwaysBounceVertical: true;
  scrollEventThrottle: 16;
  refreshControl?: ReactElement;
  contentContainerStyle: { flexGrow: number };
  style?: ViewStyle;
};

/**
 * Props that give a FlatList the same pull-to-refresh behavior.
 *
 * @returns Props to spread onto the list, and a spinner for the web gesture.
 */
export const usePullRefreshList = (): { listProps: PullRefreshListProps; indicator: ReactNode } => {
  const pull = usePullRefresh();
  return {
    indicator: pull.indicator,
    listProps: {
      ref: pull.setHost,
      alwaysBounceVertical: true,
      scrollEventThrottle: 16,
      refreshControl: pull.refreshControl,
      contentContainerStyle: { flexGrow: 1 },
      style: contained,
    },
  };
};
