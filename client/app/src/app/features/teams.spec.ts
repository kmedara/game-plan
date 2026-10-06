import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TeamsPageComponent } from './teams';
import { ApiClient } from '../core/api-client';

describe('TeamsPageComponent', () => {
  let fixture: ComponentFixture<TeamsPageComponent>;

  beforeEach(async () => {
    const api = jasmine.createSpyObj<ApiClient>('ApiClient', [
      'listTeams',
      'createTeam',
      'setTeamId',
      'logout',
      'searchTeams',
      'requestJoin',
    ]);
    api.listTeams.and.resolveTo([]);
    api.searchTeams.and.resolveTo({ teams: [] });

    await TestBed.configureTestingModule({
      imports: [TeamsPageComponent],
      providers: [provideRouter([]), { provide: ApiClient, useValue: api }],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('defaults to join autocomplete when the user has no teams', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Join an existing team or create a new one');
    expect(text).toContain('Join a team');
    expect(text).toContain('Request to join');
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input[role="combobox"]',
    );
    expect(input).not.toBeNull();
  });
});
