/**
 * Vitest + Angular TestBed bootstrap (Zone.js).
 */

import '@angular/compiler';
import '@analogjs/vitest-angular/setup-zone';

import { TestBed, getTestBed } from '@angular/core/testing';
import { provideTranslocoForTests } from './testing/transloco';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
  { teardown: { destroyAfterEach: true } },
);

const configureTestingModule = TestBed.configureTestingModule.bind(TestBed);
TestBed.configureTestingModule = (moduleDef) =>
  configureTestingModule({
    ...moduleDef,
    providers: [...(moduleDef.providers ?? []), ...provideTranslocoForTests()],
  });
