import { TestBed } from '@angular/core/testing';
import { ApiClient } from './api-client';
import { TeamBrand, applyTeamColors, teamColorOverrides } from './team-brand';

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

describe('TeamBrand', () => {
  it('caches a presigned logo url', async () => {
    const api = jasmine.createSpyObj<ApiClient>('ApiClient', ['presignDownload']);
    api.presignDownload.and.resolveTo({
      downloadUrl: 'https://cdn.example/logo.png',
      objectKey: 'uploads/team/logo',
    });
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
    const brand = TestBed.inject(TeamBrand);

    await brand.rememberLogo('uploads/team/logo');
    await brand.rememberLogo('uploads/team/logo');

    expect(api.presignDownload).toHaveBeenCalledTimes(1);
    expect(brand.logoFor('uploads/team/logo')).toBe('https://cdn.example/logo.png');
  });
});
