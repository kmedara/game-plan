import { createSpyObj, type SpyObj } from '../testing/spy';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { ActiveTeamService } from './core/active-team.service';
import { ApiClientService } from './core/api-client.service';
import { LiveSocketService } from './core/live-socket.service';
import { PushRegistrationService } from './core/push-registration.service';
import { ThemePreferenceService } from './core/theme-preference.service';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let api: SpyObj<ApiClientService>;
  let activeTeam: SpyObj<ActiveTeamService>;
  let live: SpyObj<LiveSocketService>;
  let push: SpyObj<PushRegistrationService>;
  let theme: SpyObj<ThemePreferenceService>;
  let router: Router;

  const setup = async (): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: api },
        { provide: ActiveTeamService, useValue: activeTeam },
        { provide: LiveSocketService, useValue: live },
        { provide: PushRegistrationService, useValue: push },
        { provide: ThemePreferenceService, useValue: theme },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = createSpyObj<ApiClientService>(
      'ApiClientService',
      ['isAuthenticated', 'refreshSession', 'accessToken'],
      { hasTeams: signal(false), user: undefined },
    );
    activeTeam = createSpyObj<ActiveTeamService>('ActiveTeamService', ['refresh']);
    activeTeam.refresh.mockResolvedValue(undefined);
    live = createSpyObj<LiveSocketService>('LiveSocketService', ['connect']);
    push = createSpyObj<PushRegistrationService>('PushRegistrationService', ['register']);
    push.register.mockResolvedValue(undefined);
    theme = createSpyObj<ThemePreferenceService>('ThemePreferenceService', ['restore']);
    theme.restore.mockResolvedValue(undefined);
  });

  it('renders the root router outlet', async () => {
    api.isAuthenticated.mockReturnValue(false);
    api.refreshSession.mockResolvedValue(false);
    await setup();
    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
    expect(theme.restore).toHaveBeenCalled();
  });

  it('refreshes teams when already authenticated', async () => {
    api.isAuthenticated.mockReturnValue(true);
    await setup();
    await vi.waitFor(() => expect(activeTeam.refresh).toHaveBeenCalled());
    expect(api.refreshSession).not.toHaveBeenCalled();
  });

  it('sends incomplete profiles to complete-profile after refresh', async () => {
    api.isAuthenticated.mockReturnValue(false);
    api.refreshSession.mockResolvedValue(true);
    Object.defineProperty(api, 'user', {
      get: () => ({ needsProfileCompletion: true }),
    });
    await setup();
    await vi.waitFor(() =>
      expect(router.navigateByUrl).toHaveBeenCalledWith('/complete-profile'),
    );
    expect(live.connect).not.toHaveBeenCalled();
  });

  it('connects live delivery and registers push after a successful refresh', async () => {
    api.isAuthenticated.mockReturnValue(false);
    api.refreshSession.mockResolvedValue(true);
    api.accessToken.mockReturnValue('access');
    Object.defineProperty(api, 'user', {
      get: () => ({ needsProfileCompletion: false }),
    });
    await setup();
    await vi.waitFor(() => {
      expect(live.connect).toHaveBeenCalledWith('access');
      expect(push.register).toHaveBeenCalled();
      expect(activeTeam.refresh).toHaveBeenCalled();
    });
  });
});
