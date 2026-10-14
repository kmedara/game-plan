/**
 * English and Spanish catalogs, chosen from the device language list.
 */

import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es.json';

/** Languages with translation catalogs. */
export const SUPPORTED_LANGS = ['en', 'es'] as const;

/** A language that has a catalog. */
export type AppLang = (typeof SUPPORTED_LANGS)[number];

/**
 * Maps preferred language tags to a supported catalog.
 *
 * @param languages - Preferred languages, most preferred first.
 * @returns `en` or `es`.
 */
export const detectAppLang = (languages: readonly string[]): AppLang => {
  const supported = new Set<string>(SUPPORTED_LANGS);
  for (const tag of languages) {
    const primary = tag.trim().toLowerCase().split('-')[0];
    if (primary !== undefined && supported.has(primary)) return primary as AppLang;
  }
  return 'en';
};

const language = detectAppLang(getLocales().map((locale) => locale.languageTag));

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: language,
  fallbackLng: 'en',
  initImmediate: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** Active BCP 47 locale for date formatting. */
export const appLocale = language === 'es' ? 'es' : 'en-US';

export { i18n };
