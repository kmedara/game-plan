import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ProfilePageComponent } from './profile';
import { ActiveTeamService } from '../core/active-team.service';
import { ApiClientService } from '../core/api-client.service';
import type { TeamSummary } from '@gameplan/types';

describe('ProfilePageComponent', () => {
  let fixture: ComponentFixture<ProfilePageComponent>;
  let api: SpyObj<ApiClientService>;
  let activeTeam: SpyObj<ActiveTeamService>;
  let router: Router;
  const team: TeamSummary = {
    teamId: 'team-1',
    name: 'Peoria Pigs',
    timeZone: 'America/Chicago',
    role: 'player',
    positions: ['Wing'],
  };

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', [
      'getMe',
      'listTeams',
      'logout',
      'presignUpload',
      'presignDownload',
      'updateProfile',
      'setPositions',
    ]);
    api.getMe.mockResolvedValue({
      userId: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada Player',
      accountKind: 'adult',
    });
    api.listTeams.mockResolvedValue([team]);
    api.presignDownload.mockResolvedValue({
      downloadUrl: 'https://cdn.example/photo.jpg',
      objectKey: 'uploads/u1/photo',
    });
    activeTeam = createSpyObj<ActiveTeamService>('ActiveTeamService', ['clear']);

    await TestBed.configureTestingModule({
      imports: [ProfilePageComponent],
      providers: [
        provideRouter([{ path: 'login', children: [] }]),
        { provide: ApiClientService, useValue: api },
        { provide: ActiveTeamService, useValue: activeTeam },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
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
    expect(text).toContain('Sign out');
  });

  it('signs out and returns to login', async () => {
    await fixture.componentInstance.logout();
    expect(activeTeam.clear).toHaveBeenCalled();
    expect(api.logout).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('reuses position controls per team', () => {
    const component = fixture.componentInstance;
    const first = component.positionControl('team-1');
    expect(component.positionControl('team-1')).toBe(first);
  });

  it('validates photo uploads', async () => {
    const component = fixture.componentInstance;
    await component.onPhoto({ target: document.createElement('input') } as unknown as Event);

    const badInput = document.createElement('input');
    Object.defineProperty(badInput, 'files', { value: [new File(['x'], 'x.txt', { type: 'text/plain' })] });
    await component.onPhoto({ target: badInput } as unknown as Event);
    expect(component.photoError()).toContain('JPEG');

    const hugeInput = document.createElement('input');
    Object.defineProperty(hugeInput, 'files', {
      value: [new File([new Uint8Array(6 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' })],
    });
    await component.onPhoto({ target: hugeInput } as unknown as Event);
    expect(component.photoError()).toContain('5 MB');
  });

  it('uploads a photo and loads its display URL', async () => {
    const component = fixture.componentInstance;
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    api.presignUpload.mockResolvedValue({
      uploadUrl: 'https://upload.example/put',
      objectKey: 'uploads/u1/photo',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    api.updateProfile.mockResolvedValue({
      userId: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada Player',
      accountKind: 'adult',
      photoKey: 'uploads/u1/photo',
    });

    await component.onPhoto({ target: input } as unknown as Event);
    expect(component.photoUrl()).toBe('https://cdn.example/photo.jpg');
    expect(component.uploading()).toBe(false);
  });

  it('surfaces photo upload failures', async () => {
    api.presignUpload.mockRejectedValue(new Error('fail'));
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    await fixture.componentInstance.onPhoto({ target: input } as unknown as Event);
    expect(fixture.componentInstance.photoError()).toContain('Could not save');
  });

  it('rejects a photo when the storage upload is refused', async () => {
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    api.presignUpload.mockResolvedValue({
      uploadUrl: 'https://upload.example/put',
      objectKey: 'uploads/u1/photo',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);

    await fixture.componentInstance.onPhoto({ target: input } as unknown as Event);

    expect(api.updateProfile).not.toHaveBeenCalled();
    expect(fixture.componentInstance.photoError()).toContain('Could not save');
  });

  it('removes the profile photo', async () => {
    api.updateProfile.mockResolvedValue({
      userId: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada Player',
      accountKind: 'adult',
    });
    await fixture.componentInstance.removePhoto();
    expect(fixture.componentInstance.photoUrl()).toBeUndefined();
  });

  it('adds and removes positions', async () => {
    const component = fixture.componentInstance;
    await component.addPosition(team);
    expect(api.setPositions).not.toHaveBeenCalled();
    component.positionControl('team-1').setValue('Center');
    api.setPositions.mockResolvedValue({ ...team, positions: ['Wing', 'Center'] });
    await component.addPosition(team);
    expect(component.teams()[0]?.positions).toEqual(['Wing', 'Center']);

    api.setPositions.mockResolvedValue({ ...team, positions: ['Center'] });
    await component.removePosition({ ...team, positions: ['Wing', 'Center'] }, 'Wing');
    expect(component.teams()[0]?.positions).toEqual(['Center']);
  });

  it('adds and removes positions on a team that has none yet', async () => {
    const component = fixture.componentInstance;
    const bare: TeamSummary = { teamId: 'team-2', name: 'Bare', timeZone: 'UTC', role: 'player' };
    component.teams.set([team, bare]);
    component.positionControl('team-2').setValue('Goalie');
    api.setPositions.mockResolvedValue({ ...bare, positions: ['Goalie'] });

    await component.addPosition(bare);
    expect(api.setPositions).toHaveBeenLastCalledWith('team-2', ['Goalie']);
    expect(component.teams()[0]).toEqual(team);
    expect(component.teams()[1]?.positions).toEqual(['Goalie']);

    api.setPositions.mockResolvedValue(bare);
    await component.removePosition(bare, 'Goalie');
    expect(api.setPositions).toHaveBeenLastCalledWith('team-2', []);
  });

  it('shows a generic position error when the save rejects with a non-error', async () => {
    api.setPositions.mockRejectedValue('offline');
    fixture.componentInstance.positionControl('team-1').setValue('Extra');
    await fixture.componentInstance.addPosition(team);
    expect(fixture.componentInstance.positionError()['team-1']).toContain('Could not save');
  });

  it('maps position save errors', async () => {
    api.setPositions.mockRejectedValue(new Error('too_many_positions'));
    fixture.componentInstance.positionControl('team-1').setValue('Extra');
    await fixture.componentInstance.addPosition(team);
    expect(fixture.componentInstance.positionError()['team-1']).toContain('8 positions');

    api.setPositions.mockRejectedValue(new Error('invalid_body'));
    await fixture.componentInstance.addPosition(team);
    expect(fixture.componentInstance.positionError()['team-1']).toContain('letters and numbers');

    api.setPositions.mockRejectedValue(new Error('other'));
    await fixture.componentInstance.addPosition(team);
    expect(fixture.componentInstance.positionError()['team-1']).toContain('Could not save');
  });

  it('shows a load failure message', async () => {
    api.getMe.mockRejectedValue(new Error('offline'));
    await (fixture.componentInstance as unknown as { load: () => Promise<void> }).load();
    expect(fixture.componentInstance.photoError()).toContain('Could not load');
  });

  it('leaves photoUrl empty when presign fails', async () => {
    api.getMe.mockResolvedValue({
      userId: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada Player',
      accountKind: 'adult',
      photoKey: 'uploads/u1/photo',
    });
    api.presignDownload.mockRejectedValue(new Error('denied'));
    const photoFixture = TestBed.createComponent(ProfilePageComponent);
    photoFixture.detectChanges();
    await photoFixture.whenStable();
    expect(photoFixture.componentInstance.photoUrl()).toBeUndefined();
  });

  it('surfaces remove-photo failures', async () => {
    api.updateProfile.mockRejectedValue(new Error('fail'));
    await fixture.componentInstance.removePhoto();
    expect(fixture.componentInstance.photoError()).toContain('Could not remove');
  });
});
