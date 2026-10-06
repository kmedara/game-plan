import { TestBed } from '@angular/core/testing';
import type { PreferencesLike } from './session.service';
import {
  THEME_MODE_KEY,
  THEME_PREFERENCES,
  ThemePreferenceService,
  capacitorThemePreferences,
  type ThemeMode,
} from './theme-preference.service';

const preferencesMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: preferencesMock,
}));

describe('ThemePreferenceService', () => {
  let saved: string | null;
  let savedKey: string | undefined;
  let theme: ThemePreferenceService;

  const store: PreferencesLike = {
    get: async () => ({ value: saved }),
    set: async ({ key, value }) => {
      savedKey = key;
      saved = value;
    },
    remove: async () => {
      saved = null;
    },
  };

  beforeEach(() => {
    saved = null;
    savedKey = undefined;
    document.documentElement.style.colorScheme = '';
    TestBed.configureTestingModule({
      providers: [{ provide: THEME_PREFERENCES, useValue: store }],
    });
    theme = TestBed.inject(ThemePreferenceService);
  });

  it('follows the system when nothing is saved', async () => {
    await theme.restore();
    expect(theme.mode()).toBe('system');
    expect(document.documentElement.style.colorScheme).toBe('light dark');
  });

  it('writes the color scheme for each mode', async () => {
    const expected: Record<ThemeMode, string> = {
      system: 'light dark',
      light: 'light',
      dark: 'dark',
    };
    for (const mode of Object.keys(expected) as ThemeMode[]) {
      await theme.setMode(mode);
      expect(savedKey).toBe(THEME_MODE_KEY);
      expect(saved).toBe(mode);
      expect(document.documentElement.style.colorScheme).toBe(expected[mode]);
    }
  });

  it('restores a saved dark preference', async () => {
    saved = 'dark';
    await theme.restore();
    expect(theme.mode()).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('ignores an unknown stored value', async () => {
    saved = 'sepia';
    await theme.restore();
    expect(theme.mode()).toBe('system');
    expect(document.documentElement.style.colorScheme).toBe('light dark');
  });

  it('falls back to system when preferences cannot be read', async () => {
    const failing: PreferencesLike = {
      get: async () => {
        throw new Error('unavailable');
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: THEME_PREFERENCES, useValue: failing }],
    });
    const resilient = TestBed.inject(ThemePreferenceService);
    await resilient.restore();
    expect(resilient.mode()).toBe('system');
  });

  it('delegates through the Capacitor Preferences adapter', async () => {
    preferencesMock.get.mockResolvedValue({ value: 'light' });
    preferencesMock.set.mockResolvedValue(undefined);
    preferencesMock.remove.mockResolvedValue(undefined);
    const adapter = capacitorThemePreferences();
    await expect(adapter.get({ key: THEME_MODE_KEY })).resolves.toEqual({ value: 'light' });
    await adapter.set({ key: THEME_MODE_KEY, value: 'dark' });
    await adapter.remove({ key: THEME_MODE_KEY });
    expect(preferencesMock.get).toHaveBeenCalledWith({ key: THEME_MODE_KEY });
    expect(preferencesMock.set).toHaveBeenCalledWith({ key: THEME_MODE_KEY, value: 'dark' });
    expect(preferencesMock.remove).toHaveBeenCalledWith({ key: THEME_MODE_KEY });
  });
});
