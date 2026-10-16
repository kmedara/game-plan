/**
 * App-wide API client, selected team, and live socket.
 */

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { TeamSummary, TeamTheme } from '@gameplan/types';
import { ApiClient } from './api';
import { LiveSocket } from './live-socket';
import { brandColors, type Brand } from './theme';

type AppState = {
  api: ApiClient;
  live: LiveSocket;
  teams: TeamSummary[];
  refreshTeams: () => Promise<void>;
  /** Replace one team in the cached list so other screens pick up a saved theme. */
  patchTeam: (team: TeamSummary) => void;
  selectTeam: (teamId: string) => void;
  /** Draft colors for the team settings page. The header uses these until cleared. */
  setPreviewTheme: (theme: TeamTheme | undefined) => void;
  brand: Brand;
};

const AppContext = createContext<AppState | undefined>(undefined);

let teamsCache: TeamSummary[] = [];
const teamListeners = new Set<() => void>();
const setTeams = (teams: TeamSummary[]): void => {
  teamsCache = teams;
  for (const listener of teamListeners) listener();
};

/**
 * Provides the API client for the signed-in and signed-out trees.
 */
export const AppStateProvider = ({ children }: { children: ReactNode }) => {
  const api = useMemo(() => new ApiClient(), []);
  const live = useMemo(() => new LiveSocket(api), [api]);
  const [previewTheme, setPreviewTheme] = useState<TeamTheme | undefined>();
  const snapshot = useSyncExternalStore(api.subscribe, () => api.selectedTeamId);
  const teams = useSyncExternalStore(
    (listener) => {
      teamListeners.add(listener);
      return () => teamListeners.delete(listener);
    },
    () => teamsCache,
  );

  const refreshTeams = async (): Promise<void> => {
    const next = await api.listTeams();
    setTeams(next);
    await api.restoreTeamId();
    const selected = next.find((team) => team.teamId === api.selectedTeamId) ?? next[0];
    if (selected !== undefined && api.selectedTeamId !== selected.teamId) {
      api.setTeamId(selected.teamId);
    }
    if (selected === undefined) api.setTeamId(undefined);
  };

  const patchTeam = (team: TeamSummary): void => {
    setTeams(teamsCache.map((item) => (item.teamId === team.teamId ? team : item)));
  };

  const selectTeam = (teamId: string): void => {
    api.setTeamId(teamId);
  };

  const active = teams.find((team) => team.teamId === snapshot);
  const brand = brandColors(previewTheme ?? active?.theme);

  useEffect(() => {
    void api.restoreTeamId();
  }, [api]);

  const value = useMemo(
    () => ({ api, live, teams, refreshTeams, patchTeam, selectTeam, setPreviewTheme, brand }),
    [api, live, teams, snapshot, previewTheme, brand.primary, brand.secondary, brand.accent, brand.stops.join()],
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
