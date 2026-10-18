/**
 * App-wide API client, selected team, and live socket.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { TeamSummary, TeamTheme } from '@gameplan/types';
import { View } from 'react-native';
import { ApiClient } from './api';
import { LiveSocket } from './live-socket';
import { rememberTeam, teamsQuery } from './queries/teams';
import { bindPersistedMutations } from './queries/schedule';
import { cacheUserMismatch, claimCacheUser } from './query-client';
import { brandColors, type Brand } from './theme';

type AppState = {
  api: ApiClient;
  live: LiveSocket;
  teams: TeamSummary[];
  /** Replace one team in the cached list so other screens pick up a saved theme. */
  patchTeam: (team: TeamSummary) => void;
  selectTeam: (teamId: string) => void;
  /** Draft colors for the team settings page. The header uses these until cleared. */
  setPreviewTheme: (theme: TeamTheme | undefined) => void;
  /**
   * Remembers a team whose brand should cover the shell, and returns a function
   * that forgets that claim. Later claims win until they are released.
   */
  pushBrandTeam: (teamId: string) => () => void;
  /** The team painting the shell, when there is one. */
  brandTeam: TeamSummary | undefined;
  brand: Brand;
};

const AppContext = createContext<AppState | undefined>(undefined);
const EMPTY_TEAMS: TeamSummary[] = [];

const applySelectedTeam = async (api: ApiClient, teams: TeamSummary[]): Promise<void> => {
  await api.restoreTeamId();
  const selected = teams.find((team) => team.teamId === api.selectedTeamId) ?? teams[0];
  if (selected !== undefined && api.selectedTeamId !== selected.teamId) {
    api.setTeamId(selected.teamId);
  }
  if (selected === undefined) api.setTeamId(undefined);
};

/**
 * Provides the API client for the signed-in and signed-out trees.
 */
export const AppStateProvider = ({
  api: providedApi,
  children,
}: {
  /** Session already restored before the persisted cache hydrates. */
  api?: ApiClient;
  children: ReactNode;
}) => {
  const queryClient = useQueryClient();
  const api = useMemo(() => providedApi ?? new ApiClient(), [providedApi]);
  const live = useMemo(() => new LiveSocket(api), [api]);
  const [previewTheme, setPreviewTheme] = useState<TeamTheme | undefined>();
  const [brandStack, setBrandStack] = useState<{ token: number; teamId: string }[]>([]);
  const brandToken = useRef(0);
  const pushBrandTeam = useCallback((teamId: string): (() => void) => {
    const token = brandToken.current + 1;
    brandToken.current = token;
    setBrandStack((current) => [...current, { token, teamId }]);
    return () => setBrandStack((current) => current.filter((frame) => frame.token !== token));
  }, []);
  const signedIn = useSyncExternalStore(api.subscribe, () => api.isAuthenticated());
  const userId = useSyncExternalStore(api.subscribe, () => api.user?.userId);
  const switchedUser = cacheUserMismatch(userId);
  const { data: teams } = useQuery({ ...teamsQuery(api), enabled: signedIn && !switchedUser });
  const list = switchedUser ? EMPTY_TEAMS : (teams ?? EMPTY_TEAMS);
  bindPersistedMutations(queryClient, api);

  useLayoutEffect(() => {
    if (!claimCacheUser(queryClient, userId)) return;
    setPreviewTheme(undefined);
    setBrandStack([]);
    api.clearTeamContext();
  }, [api, queryClient, userId]);

  const patchTeam = (team: TeamSummary): void => {
    rememberTeam(queryClient, team);
  };

  const selectTeam = (teamId: string): void => {
    api.setTeamId(teamId);
  };

  const contextTeamId = brandStack.at(-1)?.teamId;
  const contextTeam = contextTeamId === undefined ? undefined : list.find((team) => team.teamId === contextTeamId);
  const soleTeam = list.length === 1 ? list[0] : undefined;
  const brandTeam = contextTeam ?? soleTeam;
  const brand = brandColors(previewTheme ?? brandTeam?.theme);

  useEffect(() => {
    void api.restoreTeamId();
  }, [api]);

  useEffect(() => {
    if (teams === undefined) return;
    void applySelectedTeam(api, teams);
  }, [api, teams]);

  const value = useMemo(
    () => ({ api, live, teams: list, patchTeam, selectTeam, setPreviewTheme, pushBrandTeam, brandTeam, brand }),
    [api, live, list, previewTheme, pushBrandTeam, brandTeam, brand.primary, brand.secondary, brand.accent, brand.stops.join()],
  );

  if (switchedUser) return <View className="flex-1 bg-canvas" />;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

/** The shared API client and team switcher. */
export const useApp = (): AppState => {
  const value = useContext(AppContext);
  if (value === undefined) throw new Error('useApp outside provider');
  return value;
};

/**
 * Paints the shell with one team's brand while this screen is showing it.
 *
 * A single membership already brands the whole app, so the claim is skipped
 * unless the athlete belongs to several teams.
 *
 * @param teamId - The team to show, or `undefined` to leave the shell alone.
 */
export const useBrandTeam = (teamId: string | undefined): void => {
  const { pushBrandTeam, teams } = useApp();
  const claimed = teams.length > 1 ? teamId : undefined;
  useLayoutEffect(() => {
    if (claimed === undefined) return;
    return pushBrandTeam(claimed);
  }, [pushBrandTeam, claimed]);
};

/** Active team summary, when the list has been loaded. */
export const useActiveTeam = (): { team: TeamSummary | undefined; theme: TeamTheme | undefined } => {
  const { api, teams } = useApp();
  const teamId = useSyncExternalStore(api.subscribe, () => api.selectedTeamId);
  const team = teams.find((item) => item.teamId === teamId);
  return { team, theme: team?.theme };
};
