import { describe, expect, it } from 'vitest';
import { appConfig } from './app.config';
import { routes } from './app.routes';

describe('app routes and config', () => {
  it('exports the router providers and signed-in layout routes', () => {
    expect(appConfig.providers.length).toBeGreaterThan(0);
    expect(routes.some((route) => route.path === 'login')).toBe(true);
    expect(routes.some((route) => route.redirectTo === 'teams')).toBe(true);
    const layout = routes.find((route) => route.component !== undefined && route.children);
    expect(layout?.children?.some((child) => child.path === 'schedule')).toBe(true);
    expect(layout?.children?.some((child) => child.path === 'invite/:code')).toBe(true);
  });
});
