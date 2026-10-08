/**
 * Browser-language detection and Transloco providers for the app shell.
 */

import { isDevMode, provideAppInitializer, inject, LOCALE_ID } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import {
  provideTransloco,
  TranslocoService,
  type Translation,
  type TranslocoLoader,
} from '@jsverse/transloco';
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

/** Languages with translation catalogs. */
export const SUPPORTED_LANGS = ['en', 'es'] as const;

/** A language that has a catalog. */
export type AppLang = (typeof SUPPORTED_LANGS)[number];

registerLocaleData(localeEs);

/**
 * Maps a BCP 47 tag (or list) to a supported app language.
 *
 * The first supported language in the preference list wins. A later Spanish
 * tag does not override English when English is preferred. Unsupported tags
 * are skipped, and English is the fallback when none match.
 *
 * @param languages - Preferred languages, most preferred first.
 * @returns `en` or `es`.
 */
export const detectBrowserLang = (
  languages: readonly string[] = typeof navigator === 'undefined'
    ? ['en']
    : navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language || 'en'],
): AppLang => {
  const supported = new Set<string>(SUPPORTED_LANGS);
  for (const tag of languages) {
    const primary = tag.trim().toLowerCase().split('-')[0];
    if (supported.has(primary)) return primary as AppLang;
  }
  return 'en';
};

/** Active language chosen at bootstrap from the device/browser. */
export const APP_LANG: AppLang = detectBrowserLang();

/** Angular `LOCALE_ID` for pipes and formatters. */
export const APP_LOCALE_ID = APP_LANG === 'es' ? 'es' : 'en-US';

/**
 * Loads `/i18n/{lang}.json` from the static `public` folder.
 */
@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string) {
    return this.http.get<Translation>(`./i18n/${lang}.json`);
  }
}

/**
 * Sets `html[lang]` and preloads the active catalog before the first paint.
 *
 * @returns A promise that resolves when translations are ready.
 */
const preloadAppLang = (): Promise<Translation> => {
  document.documentElement.lang = APP_LANG;
  const transloco = inject(TranslocoService);
  transloco.setActiveLang(APP_LANG);
  return lastValueFrom(transloco.load(APP_LANG));
};

/**
 * App-wide Transloco + HTTP + locale providers.
 *
 * @returns Providers for `appConfig`.
 */
export const provideAppI18n = () => [
  provideHttpClient(),
  { provide: LOCALE_ID, useValue: APP_LOCALE_ID },
  provideTransloco({
    config: {
      availableLangs: [...SUPPORTED_LANGS],
      defaultLang: APP_LANG,
      fallbackLang: 'en',
      reRenderOnLangChange: false,
      prodMode: !isDevMode(),
    },
    loader: TranslocoHttpLoader,
  }),
  provideAppInitializer(preloadAppLang),
];
