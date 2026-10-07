import { createSpyObj, type SpyObj } from '../../testing/spy';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActiveTeamService } from '../core/active-team.service';
import { ApiClientService } from '../core/api-client.service';
import { TeamBrandService } from '../core/team-brand.service';
import { AppLayoutComponent, childTitle } from './app-layout';
import { ActivatedRoute } from '@angular/router';

describe('childTitle', () => {
  it('reads nested titles and ignores empty values', () => {
    const leaf = {
      firstChild: null,
      snapshot: { data: { title: 'Schedule' } },
    } as unknown as ActivatedRoute;
    const parent = { firstChild: leaf, snapshot: { data: {} } } as unknown as ActivatedRoute;
    expect(childTitle(parent)).toBe('Schedule');
    expect(
      childTitle({
        firstChild: null,
        snapshot: { data: { title: '' } },
      } as unknown as ActivatedRoute),
    ).toBeUndefined();
    expect(
      childTitle({
        firstChild: null,
        snapshot: { data: { title: 12 } },
      } as unknown as ActivatedRoute),
    ).toBeUndefined();
    expect(
      childTitle({
        firstChild: null,
        snapshot: undefined,
      } as unknown as ActivatedRoute),
    ).toBeUndefined();
  });
});

describe('AppLayoutComponent', () => {
  let fixture: ComponentFixture<AppLayoutComponent>;
  let api: SpyObj<ApiClientService>;
  let activeTeam: {
    teams: ReturnType<typeof signal>;
    teamId: ReturnType<typeof signal>;
    active: ReturnType<typeof signal>;
    refresh: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', [], {
      hasTeams: signal(false),
    });
    activeTeam = {
      teams: signal([]),
      teamId: signal(undefined),
      active: signal(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [AppLayoutComponent],
      providers: [
        provideRouter([
          {
            path: '',
            component: AppLayoutComponent,
            children: [{ path: 'teams', component: AppLayoutComponent, data: { title: 'Teams' } }],
          },
        ]),
        { provide: ApiClientService, useValue: api },
        { provide: ActiveTeamService, useValue: activeTeam },
        {
          provide: TeamBrandService,
          useValue: { logoFor: () => undefined },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppLayoutComponent);
    fixture.detectChanges();
  });

  it('hides schedule and chats nav when the user has no teams', () => {
    api.hasTeams.set(false);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Teams');
    expect(text).toContain('Profile');
    expect(text).not.toContain('Schedule');
    expect(text).not.toContain('Chats');
  });

  it('shows schedule and chats nav when the user has teams', () => {
    api.hasTeams.set(true);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Schedule');
    expect(text).toContain('Chats');
    expect(text).toContain('Teams');
    expect(text).toContain('Profile');
  });

  it('refreshes teams on init', () => {
    expect(activeTeam.refresh).toHaveBeenCalled();
  });

  it('forwards team changes to ActiveTeamService', async () => {
    await fixture.componentInstance.onTeamChange('team-9');
    expect(activeTeam.select).toHaveBeenCalledWith('team-9');
  });
});
