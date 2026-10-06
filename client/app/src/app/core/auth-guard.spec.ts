import { createSpyObj, type SpyObj } from '../../testing/spy';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { authGuard, completeProfileGuard } from './auth-guard';
import { ApiClientService } from './api-client.service';

describe('auth guards', () => {
  let api: SpyObj<ApiClientService>;
  let router: Router;

  beforeEach(() => {
    api = createSpyObj<ApiClientService>('ApiClientService', [
      'isAuthenticated',
      'refreshSession',
    ]);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: api },
      ],
    });
    router = TestBed.inject(Router);
  });

  describe('authGuard', () => {
    it('allows an authenticated session', async () => {
      api.isAuthenticated.mockReturnValue(true);
      await expect(TestBed.runInInjectionContext(() => authGuard({} as never, {} as never))).resolves.toBe(
        true,
      );
    });

    it('allows a successful refresh', async () => {
      api.isAuthenticated.mockReturnValue(false);
      api.refreshSession.mockResolvedValue(true);
      await expect(TestBed.runInInjectionContext(() => authGuard({} as never, {} as never))).resolves.toBe(
        true,
      );
    });

    it('redirects to login when refresh fails and auth is required', async () => {
      api.isAuthenticated.mockReturnValue(false);
      api.refreshSession.mockResolvedValue(false);
      const previous = environment.authDisabled;
      environment.authDisabled = false;
      try {
        const result = await TestBed.runInInjectionContext(() =>
          authGuard({} as never, {} as never),
        );
        expect(result).toEqual(router.parseUrl('/login'));
        expect(api.refreshSession).toHaveBeenCalledTimes(1);
      } finally {
        environment.authDisabled = previous;
      }
    });

    it('seeds a session when auth is disabled', async () => {
      api.isAuthenticated.mockReturnValue(false);
      api.refreshSession
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const previous = environment.authDisabled;
      environment.authDisabled = true;
      try {
        await expect(
          TestBed.runInInjectionContext(() => authGuard({} as never, {} as never)),
        ).resolves.toBe(true);
        expect(api.refreshSession).toHaveBeenCalledTimes(2);
      } finally {
        environment.authDisabled = previous;
      }
    });

    it('redirects when auth-disabled seeding also fails', async () => {
      api.isAuthenticated.mockReturnValue(false);
      api.refreshSession.mockResolvedValue(false);
      const previous = environment.authDisabled;
      environment.authDisabled = true;
      try {
        const result = await TestBed.runInInjectionContext(() =>
          authGuard({} as never, {} as never),
        );
        expect(result).toEqual(router.parseUrl('/login'));
      } finally {
        environment.authDisabled = previous;
      }
    });
  });

  describe('completeProfileGuard', () => {
    it('redirects unauthenticated callers to login', async () => {
      api.isAuthenticated.mockReturnValue(false);
      api.refreshSession.mockResolvedValue(false);
      const result = await TestBed.runInInjectionContext(() =>
        completeProfileGuard({} as never, {} as never),
      );
      expect(result).toEqual(router.parseUrl('/login'));
    });

    it('redirects incomplete profiles', async () => {
      api.isAuthenticated.mockReturnValue(true);
      Object.defineProperty(api, 'user', {
        get: () => ({ needsProfileCompletion: true }),
      });
      const result = await TestBed.runInInjectionContext(() =>
        completeProfileGuard({} as never, {} as never),
      );
      expect(result).toEqual(router.parseUrl('/complete-profile'));
    });

    it('allows a complete profile after refresh', async () => {
      api.isAuthenticated.mockReturnValue(false);
      api.refreshSession.mockResolvedValue(true);
      Object.defineProperty(api, 'user', {
        get: () => ({ needsProfileCompletion: false }),
      });
      await expect(
        TestBed.runInInjectionContext(() => completeProfileGuard({} as never, {} as never)),
      ).resolves.toBe(true);
    });
  });
});
