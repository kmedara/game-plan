import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfilePageComponent } from './profile';
import { ApiClient } from '../core/api-client';

describe('ProfilePageComponent', () => {
  let fixture: ComponentFixture<ProfilePageComponent>;

  beforeEach(async () => {
    const api = jasmine.createSpyObj<ApiClient>('ApiClient', ['getMe', 'listTeams']);
    api.getMe.and.resolveTo({
      userId: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada Player',
      accountKind: 'adult',
    });
    api.listTeams.and.resolveTo([
      {
        teamId: 'team-1',
        name: 'Peoria Pigs',
        timeZone: 'America/Chicago',
        role: 'player',
        positions: ['Wing'],
      },
    ]);

    await TestBed.configureTestingModule({
      imports: [ProfilePageComponent],
      providers: [{ provide: ApiClient, useValue: api }],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfilePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows the profile and positions on each team', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ada Player');
    expect(text).toContain('ada@example.com');
    expect(text).toContain('Add photo');
    expect(text).toContain('Peoria Pigs');
    expect(text).toContain('Wing');
  });
});
