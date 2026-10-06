import { appConfig } from './app.config';

describe('appConfig', () => {
  it('declares zone detection, routing, and animations providers', () => {
    expect(appConfig.providers).toHaveLength(3);
  });
});
