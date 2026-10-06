import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';
import { ApiClient } from './core/api-client';
import { LiveSocket } from './core/live-socket';
import { PushRegistration } from './core/push-registration';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let api: jasmine.SpyObj<ApiClient>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiClient>(
      'ApiClient',
      ['isAuthenticated', 'refreshSession', 'listTeams', 'accessToken'],
      { hasTeams: signal(false), user: undefined },
    );
    api.isAuthenticated.and.returnValue(false);
    api.refreshSession.and.resolveTo(false);
    api.listTeams.and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        {
          provide: LiveSocket,
          useValue: jasmine.createSpyObj<LiveSocket>('LiveSocket', ['connect']),
        },
        {
          provide: PushRegistration,
          useValue: jasmine.createSpyObj<PushRegistration>('PushRegistration', ['register']),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
  });

  it('hides schedule and chats nav when the user has no teams', () => {
    api.isAuthenticated.and.returnValue(true);
    fixture.componentInstance.showNav = true;
    api.hasTeams.set(false);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Teams');
    expect(text).not.toContain('Schedule');
    expect(text).not.toContain('Chats');
  });

  it('shows schedule and chats nav when the user has teams', () => {
    api.isAuthenticated.and.returnValue(true);
    fixture.componentInstance.showNav = true;
    api.hasTeams.set(true);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Schedule');
    expect(text).toContain('Chats');
    expect(text).toContain('Teams');
  });
});
