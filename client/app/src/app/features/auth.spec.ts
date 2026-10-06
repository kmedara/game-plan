import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AuthPageComponent, hostedUiLoginHref } from './auth';
import { environment } from '../../environments/environment';
import { ApiClientService } from '../core/api-client.service';
import { LiveSocketService } from '../core/live-socket.service';
import { PushRegistrationService } from '../core/push-registration.service';

describe('AuthPageComponent', () => {
  let fixture: ComponentFixture<AuthPageComponent>;
  let api: SpyObj<ApiClientService>;
  let live: SpyObj<LiveSocketService>;
  let push: SpyObj<PushRegistrationService>;
  let router: Router;
  let authDisabled: boolean;
  const routeState = { queryError: null as string | null };

  beforeEach(async () => {
    authDisabled = environment.authDisabled;
    routeState.queryError = null;
    api = createSpyObj<ApiClientService>('ApiClientService', ['refreshSession', 'accessToken']);
    api.refreshSession.mockResolvedValue(false);
    live = createSpyObj<LiveSocketService>('LiveSocketService', ['connect']);
    push = createSpyObj<PushRegistrationService>('PushRegistrationService', ['register']);

    await TestBed.configureTestingModule({
      imports: [AuthPageComponent],
      providers: [
        provideRouter([{ path: 'teams', children: [] }]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: {
                get: (key: string) => (key === 'error' ? routeState.queryError : null),
              },
            },
          },
        },
        { provide: ApiClientService, useValue: api },
        { provide: LiveSocketService, useValue: live },
        { provide: PushRegistrationService, useValue: push },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(AuthPageComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    environment.authDisabled = authDisabled;
  });

  it('renders the sign-in heading', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Sign in');
  });

  it('shows an error from the query string', () => {
    routeState.queryError = 'oauth_denied';
    fixture = TestBed.createComponent(AuthPageComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe('oauth_denied');
  });

  it('loads the seed user email when auth is disabled', async () => {
    environment.authDisabled = true;
    api.refreshSession.mockResolvedValue(true);
    Object.defineProperty(api, 'user', { get: () => ({ email: 'seed@localhost' }) });
    fixture = TestBed.createComponent(AuthPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.seedUserEmail()).toBe('seed@localhost');
  });

  it('builds the Cognito hosted UI login URL', () => {
    const href = hostedUiLoginHref('http://localhost:4200');
    expect(href).toBe(
      `${environment.apiBaseUrl}/identity/oauth/login?returnTo=${encodeURIComponent('http://localhost:4200/teams')}`,
    );
    expect(() => fixture.componentInstance.startHostedUi()).not.toThrow();
  });

  it('continues with a seed session and navigates to teams', async () => {
    api.refreshSession.mockResolvedValue(true);
    Object.defineProperty(api, 'user', { get: () => ({ email: 'seed@localhost' }) });
    api.accessToken.mockReturnValue('token-1');
    await fixture.componentInstance.continueLocal();
    expect(live.connect).toHaveBeenCalledWith('token-1');
    expect(push.register).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/teams');
    expect(fixture.componentInstance.busy()).toBe(false);
  });

  it('continues without a profile email or access token', async () => {
    api.refreshSession.mockResolvedValue(true);
    api.accessToken.mockReturnValue(undefined);
    await fixture.componentInstance.continueLocal();
    expect(fixture.componentInstance.seedUserEmail()).toBe('');
    expect(live.connect).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/teams');
  });

  it('reports a generic error when the seed request rejects with a non-error', async () => {
    api.refreshSession.mockRejectedValue('boom');
    await fixture.componentInstance.continueLocal();
    expect(fixture.componentInstance.error()).toBe('request_failed');
  });

  it('leaves the seed email blank when the seed profile is missing or refresh fails', async () => {
    environment.authDisabled = true;
    api.refreshSession.mockResolvedValue(true);
    fixture = TestBed.createComponent(AuthPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.seedUserEmail()).toBe('');

    api.refreshSession.mockResolvedValue(false);
    fixture = TestBed.createComponent(AuthPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.seedUserEmail()).toBe('');
  });

  it('surfaces seed session failures', async () => {
    api.refreshSession.mockResolvedValue(false);
    await fixture.componentInstance.continueLocal();
    expect(fixture.componentInstance.error()).toBe('seed_session_failed');
    expect(fixture.componentInstance.busy()).toBe(false);
  });
});
