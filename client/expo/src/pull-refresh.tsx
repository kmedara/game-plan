/**
 * Pull-to-refresh for screen scrollers.
 *
 * iOS and Android use RefreshControl. The web control is a no-op, so a touch
 * that starts at the top and moves down refetches instead of reloading the page.
 * On web the screen follows the finger down, with an arrow that flips once a
 * release would refresh, and rests open on a spinner while the refresh runs.
 */

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import ArrowDown from 'lucide-react-native/icons/arrow-down';
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

/** Share of the finger's travel the screen follows up to the threshold. */
const PULL_FOLLOW = 0.7;

/** Share it follows past the threshold, so a long pull feels stretched. */
const PULL_STRETCH = 0.25;

/** Furthest the screen moves, however far the finger goes. */
export const PULL_MAX_OFFSET = 110;

/** Where the screen rests while a refresh runs. */
const PULL_REST_OFFSET = Math.round(PULL_THRESHOLD * PULL_FOLLOW);

/** Size of the arrow or spinner badge above the screen. */
const BADGE_SIZE = 36;

/**
 * How far the screen moves for a given downward pull.
 *
 * @param distance - Finger travel in pixels since the pull began.
 * @returns The screen's offset, slowed past the threshold and capped.
 */
export const pullOffset = (distance: number): number => {
  if (distance <= 0) return 0;
  const offset =
    distance <= PULL_THRESHOLD
      ? distance * PULL_FOLLOW
      : PULL_THRESHOLD * PULL_FOLLOW + (distance - PULL_THRESHOLD) * PULL_STRETCH;
  return Math.min(offset, PULL_MAX_OFFSET);
};

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

const htmlElement = (node: unknown): HTMLElement | null =>
  typeof HTMLElement !== 'undefined' && node instanceof HTMLElement ? node : null;

/** Marks a web element whose touches belong to it, such as a drag handle, never to a pull. */
const NO_PULL = 'data-no-pull';

/**
 * Keeps a pull from starting on this element, so dragging it down does not refresh the screen.
 *
 * @param node - A view ref. Only a web element is marked.
 */
export const noPull = (node: unknown): void => {
  htmlElement(node)?.setAttribute(NO_PULL, '');
};

const contained: ViewStyle | undefined =
  Platform.OS === 'web' ? ({ overscrollBehaviorY: 'contain' } as ViewStyle) : undefined;

const grown = (style: StyleProp<ViewStyle> | undefined): StyleProp<ViewStyle> =>
  style === undefined ? { flexGrow: 1 } : [{ flexGrow: 1 }, style];

/**
 * Binds a refresh promise so a second pull is ignored until the first finishes.
 *
 * @returns The refreshing flag, the control for a native list, and refs for the scroller and its frame.
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
  const frameRef = useRef<unknown>(null);
  const setFrame = useCallback((node: unknown) => {
    frameRef.current = node;
  }, []);
  const badgeRef = useRef<unknown>(null);
  const setBadge = useCallback((node: unknown) => {
    badgeRef.current = node;
  }, []);
  const arrowRef = useRef<unknown>(null);
  const setArrow = useCallback((node: unknown) => {
    arrowRef.current = node;
  }, []);

  // Styles are set on the DOM nodes so a drag does not re-render the screen.
  const showOffset = useCallback((offset: number, options: { animate: boolean; ready?: boolean }): void => {
    const transition = options.animate ? 'transform 200ms ease-out, opacity 200ms ease-out' : 'none';
    const frame = htmlElement(frameRef.current);
    if (frame !== null) {
      frame.style.transition = transition;
      frame.style.transform = offset > 0 ? `translateY(${offset}px)` : '';
    }
    const badge = htmlElement(badgeRef.current);
    if (badge !== null) {
      badge.style.transition = transition;
      badge.style.transform = `translateY(${offset - BADGE_SIZE}px)`;
      badge.style.opacity = String(Math.min(offset / PULL_REST_OFFSET, 1));
    }
    const arrow = htmlElement(arrowRef.current);
    if (arrow !== null) {
      arrow.style.transition = 'transform 150ms ease-out';
      arrow.style.transform = options.ready === true ? 'rotate(180deg)' : '';
    }
  }, []);

  const run = (): void => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    showOffset(PULL_REST_OFFSET, { animate: true });
    void onRefreshRef.current().finally(() => {
      refreshingRef.current = false;
      setRefreshing(false);
      showOffset(0, { animate: true });
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
      const owned = event.target instanceof Element && event.target.closest(`[${NO_PULL}]`) !== null;
      if (touch === undefined || node === null || node.scrollTop > 0 || owned) {
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
        if (!refreshingRef.current) {
          showOffset(pullOffset(distance), { animate: false, ready: distance >= PULL_THRESHOLD });
        }
        return;
      }
      pullDistance = 0;
      if (!refreshingRef.current) showOffset(0, { animate: false });
    };
    const onEnd = (): void => {
      const distance = pullDistance;
      const atTop = node !== null && node.scrollTop <= 0;
      tracking = false;
      pullDistance = 0;
      if (shouldStartPullRefresh({ atTop, pullDistance: distance, refreshing: refreshingRef.current })) {
        run();
      } else if (!refreshingRef.current) {
        showOffset(0, { animate: true });
      }
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
      node.addEventListener('touchcancel', onEnd);
    };
    listen();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      if (node === null) return;
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const refreshControl =
    Platform.OS === 'web' ? undefined : (
      <RefreshControl refreshing={refreshing} onRefresh={run} tintColor={colors.field} colors={[colors.field]} />
    );

  return { setHost, setFrame, setBadge, setArrow, refreshControl, refreshing };
};

/** What {@link PullRefreshFrame} needs from the pull hook. */
export type PullRefreshState = Pick<
  ReturnType<typeof usePullRefresh>,
  'setFrame' | 'setBadge' | 'setArrow' | 'refreshing'
>;

/**
 * Holds the scroller that moves down with a web pull, and the badge above it.
 *
 * The badge shows an arrow while pulling and a spinner while refreshing.
 * Native platforms draw their own RefreshControl, so the frame is a plain box.
 *
 * @param props - The pull state and the scroller.
 * @returns The scroller in a box that clips the pulled-down screen.
 */
export const PullRefreshFrame = ({ pull, children }: { pull: PullRefreshState; children: ReactNode }) => {
  if (Platform.OS !== 'web') return <View style={{ flex: 1 }}>{children}</View>;
  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <View
        ref={pull.setBadge}
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          alignSelf: 'center',
          zIndex: 2,
          width: BADGE_SIZE,
          height: BADGE_SIZE,
          borderRadius: BADGE_SIZE / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.paper,
          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.2)',
          opacity: 0,
          transform: [{ translateY: -BADGE_SIZE }],
        }}
      >
        {pull.refreshing ? (
          <ActivityIndicator color={colors.field} />
        ) : (
          <View ref={pull.setArrow}>
            <ArrowDown size={20} color={colors.field} />
          </View>
        )}
      </View>
      <View ref={pull.setFrame} style={{ flex: 1 }}>
        {children}
      </View>
    </View>
  );
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
    <PullRefreshFrame pull={pull}>
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
    </PullRefreshFrame>
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
 * @returns Props to spread onto the list, and the state for its {@link PullRefreshFrame}.
 */
export const usePullRefreshList = (): { listProps: PullRefreshListProps; frame: PullRefreshState } => {
  const pull = usePullRefresh();
  return {
    frame: pull,
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
