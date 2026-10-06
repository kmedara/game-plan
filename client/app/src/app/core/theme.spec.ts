import { TestBed } from '@angular/core/testing';
import type { PreferencesLike } from './session-bridge';
import { THEME_MODE_KEY, THEME_PREFERENCES, ThemePreference, type ThemeMode } from './theme';

describe('ThemePreference', () => {
  let saved: string | null;
  let savedKey: string | undefined;
  let theme: ThemePreference;

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
    theme = TestBed.inject(ThemePreference);
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
});
