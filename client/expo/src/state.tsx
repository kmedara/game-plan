/**
 * App-wide API client, selected team, and live socket.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { TeamSummary, TeamTheme } from '@gameplan/types';
import { ApiClient } from './api';
import { LiveSocket } from './live-socket';
import { rememberTeam, teamsQuery } from './queries/teams';
import { bindPersistedMutations } from './queries/schedule';
import { adoptCacheOwner } from './query-client';
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
export const AppStateProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const api = useMemo(() => new ApiClient(), []);
  const live = useMemo(() => new LiveSocket(api), [api]);
  const [previewTheme, setPreviewTheme] = useState<TeamTheme | undefined>();
  const snapshot = useSyncExternalStore(api.subscribe, () => api.selectedTeamId);
  const signedIn = useSyncExternalStore(api.subscribe, () => api.isAuthenticated());
  const { data: teams } = useQuery({ ...teamsQuery(api), enabled: signedIn });
  const list = teams ?? EMPTY_TEAMS;
  bindPersistedMutations(queryClient, api);

  useEffect(() => {
    if (!signedIn) return;
    void adoptCacheOwner(queryClient, api.user?.userId);
  }, [api, queryClient, signedIn]);

  const patchTeam = (team: TeamSummary): void => {
    rememberTeam(queryClient, team);
  };

  const selectTeam = (teamId: string): void => {
    api.setTeamId(teamId);
  };

  const active = list.find((team) => team.teamId === snapshot);
  const brand = brandColors(previewTheme ?? active?.theme);

  useEffect(() => {
    void api.restoreTeamId();
  }, [api]);

  useEffect(() => {
    if (teams === undefined) return;
    void applySelectedTeam(api, teams);
  }, [api, teams]);

  const value = useMemo(
    () => ({ api, live, teams: list, patchTeam, selectTeam, setPreviewTheme, brand }),
    [api, live, list, snapshot, previewTheme, brand.primary, brand.secondary, brand.accent, brand.stops.join()],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

/** The shared API client and team switcher. */
export const useApp = (): AppState => {
  const value = useContext(AppContext);
  if (value === undefined) throw new Error('useApp outside provider');
  return value;
};

/** Active team summary, when the list has been loaded. */
export const useActiveTeam = (): { team: TeamSummary | undefined; theme: TeamTheme | undefined } => {
  const { api, teams } = useApp();
  const teamId = useSyncExternalStore(api.subscribe, () => api.selectedTeamId);
  const team = teams.find((item) => item.teamId === teamId);
  return { team, theme: team?.theme };
};
