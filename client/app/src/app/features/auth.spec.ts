import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AuthPageComponent } from './auth';
import { ApiClient } from '../core/api-client';
import { LiveSocket } from '../core/live-socket';
import { PushRegistration } from '../core/push-registration';

describe('AuthPageComponent', () => {
  let fixture: ComponentFixture<AuthPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
        {
          provide: ApiClient,
          useValue: jasmine.createSpyObj<ApiClient>('ApiClient', [
            'refreshSession',
            'accessToken',
          ]),
        },
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

    fixture = TestBed.createComponent(AuthPageComponent);
    fixture.detectChanges();
  });

  it('renders the sign-in heading', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Sign in');
  });
});
