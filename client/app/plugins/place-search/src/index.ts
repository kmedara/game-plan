/**
 * Registers the PlaceSearch Capacitor plugin.
 */

import { registerPlugin } from '@capacitor/core';
import type { PlaceSearchPlugin } from './definitions';

const PlaceSearch = registerPlugin<PlaceSearchPlugin>('PlaceSearch', {
  web: () => import('./web').then((module) => new module.PlaceSearchWeb()),
});

export * from './definitions';
export { PlaceSearch };
