import { createSpyObj, type SpyObj } from '../../testing/spy';
import { TestBed } from '@angular/core/testing';
import { ApiClientService } from './api-client.service';
import { TeamBrandService, applyTeamColors, teamColorOverrides } from './team-brand.service';

describe('teamColorOverrides', () => {
  afterEach(() => {
    applyTeamColors(undefined);
  });

  it('builds light and dark tokens from the team colors', () => {
    const overrides = teamColorOverrides({
      primary: '#7c2d12',
      secondary: '#1e40af',
      accent: '#f59e0b',
    });
    expect(overrides?.['--mat-sys-primary']).toContain('light-dark(');
    expect(overrides?.['--mat-sys-primary-container']).toContain('light-dark(');
    expect(overrides?.['--mat-sys-secondary']).toContain('light-dark(');
    expect(overrides?.['--team-secondary']).toContain('light-dark(');
    expect(overrides?.['--mat-sys-on-primary']).toMatch(/#ffffff|#171d1c/);
  });

  it('darkens pale colors for light mode and keeps them for dark mode', () => {
    const overrides = teamColorOverrides({ primary: '#ffff00' });
    expect(overrides?.['--mat-sys-primary']).toBe('light-dark(#a6a600, #ffff00)');
    expect(overrides?.['--mat-sys-on-primary']).toBe('light-dark(#ffffff, #171d1c)');
  });

  it('leaves the secondary tokens unset when the team has no secondary color', () => {
    const overrides = teamColorOverrides({ primary: '#7c2d12', accent: '#f59e0b' });
    expect(overrides?.['--mat-sys-primary']).toContain('light-dark(');
    expect(overrides?.['--team-secondary']).toBeUndefined();
  });

  it('returns nothing when the team has no primary color', () => {
    expect(teamColorOverrides({ logoKey: 'uploads/team/logo' })).toBeUndefined();
    expect(teamColorOverrides(undefined)).toBeUndefined();
  });

  it('writes the tokens onto the document and clears them again', () => {
    applyTeamColors({ primary: '#7c2d12' });
    expect(document.documentElement.style.getPropertyValue('--mat-sys-primary')).toContain(
      'light-dark(',
    );
    applyTeamColors(undefined);
    expect(document.documentElement.style.getPropertyValue('--mat-sys-primary')).toBe('');
  });
});

describe('TeamBrandService', () => {
  it('caches a presigned logo url', async () => {
    const api = createSpyObj<ApiClientService>('ApiClientService', ['presignDownload']);
    api.presignDownload.mockResolvedValue({
      downloadUrl: 'https://cdn.example/logo.png',
      objectKey: 'uploads/team/logo',
    });
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const brand = TestBed.inject(TeamBrandService);

    await brand.rememberLogo('uploads/team/logo');
    await brand.rememberLogo('uploads/team/logo');

    expect(api.presignDownload).toHaveBeenCalledTimes(1);
    expect(brand.logoFor('uploads/team/logo')).toBe('https://cdn.example/logo.png');
  });

  it('has no logo url when the team has no logo key', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(TeamBrandService).logoFor(undefined)).toBeUndefined();
  });

  it('ignores presign failures while loading a logo', async () => {
    const api = createSpyObj<ApiClientService>('ApiClientService', ['presignDownload']);
    api.presignDownload.mockRejectedValue(new Error('denied'));
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const brand = TestBed.inject(TeamBrandService);

    await brand.rememberLogo('uploads/team/broken');
    expect(brand.logoFor('uploads/team/broken')).toBeUndefined();
    expect(api.presignDownload).toHaveBeenCalledTimes(1);
  });

  it('selects a team and clears the brand', async () => {
    const api = createSpyObj<ApiClientService>('ApiClientService', ['setTeamId', 'presignDownload']);
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const brand = TestBed.inject(TeamBrandService);

    await brand.select('team-1', { primary: '#7c2d12' });
    expect(api.setTeamId).toHaveBeenCalledWith('team-1');
    expect(document.documentElement.style.getPropertyValue('--mat-sys-primary')).toContain(
      'light-dark(',
    );

    await brand.clear();
    expect(api.setTeamId).toHaveBeenCalledWith(undefined);
    expect(document.documentElement.style.getPropertyValue('--mat-sys-primary')).toBe('');
  });

  it('swallows logo download failures', async () => {
    const api = createSpyObj<ApiClientService>('ApiClientService', ['presignDownload']);
    api.presignDownload.mockRejectedValue(new Error('missing'));
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const brand = TestBed.inject(TeamBrandService);

    await brand.rememberLogo('uploads/team/missing');
    expect(brand.logoFor('uploads/team/missing')).toBeUndefined();
  });
});
