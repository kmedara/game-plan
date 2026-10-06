/**
 * Route guards for session and profile completion.
 */

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ApiClient } from './api-client';
import { environment } from '../../environments/environment';

/**
 * Allows the route when authenticated; otherwise sends the user to login.
 */
export const authGuard: CanActivateFn = async () => {
  const api = inject(ApiClient);
  const router = inject(Router);
  if (api.isAuthenticated()) return true;
  const refreshed = await api.refreshSession();
  if (refreshed) return true;
  if (environment.authDisabled) {
    const seeded = await api.refreshSession();
    if (seeded) return true;
  }
  return router.parseUrl('/login');
};

/**
 * Sends authenticated users with an incomplete profile to `/complete-profile`.
 */
export const completeProfileGuard: CanActivateFn = async () => {
  const api = inject(ApiClient);
  const router = inject(Router);
  if (!api.isAuthenticated()) {
    const refreshed = await api.refreshSession();
    if (!refreshed) return router.parseUrl('/login');
  }
  if (api.user?.needsProfileCompletion) {
    return router.parseUrl('/complete-profile');
  }
  return true;
};
