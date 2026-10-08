/**
 * Browser language detection for Transloco.
 */

import { describe, expect, it } from 'vitest';
import { detectBrowserLang } from './i18n';

describe('detectBrowserLang', () => {
  it('maps Spanish tags to es', () => {
    expect(detectBrowserLang(['es'])).toBe('es');
    expect(detectBrowserLang(['es-MX'])).toBe('es');
    expect(detectBrowserLang(['es-ES', 'en-US'])).toBe('es');
  });

  it('falls back to en for non-Spanish preferences', () => {
    expect(detectBrowserLang(['en-US'])).toBe('en');
    expect(detectBrowserLang(['fr-FR'])).toBe('en');
    expect(detectBrowserLang(['de', 'fr'])).toBe('en');
  });

  it('uses the first supported language in the preference list', () => {
    expect(detectBrowserLang(['en-US', 'es'])).toBe('en');
    expect(detectBrowserLang(['en', 'es-ES'])).toBe('en');
    expect(detectBrowserLang(['fr-FR', 'en', 'es'])).toBe('en');
    expect(detectBrowserLang(['fr-FR', 'es-AR', 'en'])).toBe('es');
  });
});
