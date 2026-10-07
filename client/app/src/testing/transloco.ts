/**
 * Transloco providers for unit tests (static catalogs, no HTTP).
 */

import { inject, Injectable, provideAppInitializer } from '@angular/core';
import {
  provideTransloco,
  TranslocoService,
  type Translation,
  type TranslocoLoader,
} from '@jsverse/transloco';
import { of } from 'rxjs';
import en from '../../public/i18n/en.json';
import es from '../../public/i18n/es.json';

const CATALOGS: Record<string, Translation> = { en, es };

@Injectable()
class TranslocoStaticLoader implements TranslocoLoader {
  getTranslation(lang: string) {
    return of(CATALOGS[lang] ?? en);
  }
}

/** Minimal Transloco wiring for TestBed component specs. */
export const provideTranslocoForTests = () => [
  ...provideTransloco({
    config: {
      availableLangs: ['en', 'es'],
      defaultLang: 'en',
      fallbackLang: 'en',
      prodMode: true,
    },
    loader: TranslocoStaticLoader,
  }),
  provideAppInitializer(() => {
    const transloco = inject(TranslocoService);
    transloco.setTranslation(en, 'en');
    transloco.setTranslation(es, 'es');
    transloco.setActiveLang('en');
  }),
];
