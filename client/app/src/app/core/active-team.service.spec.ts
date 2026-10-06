import { createSpyObj, type SpyObj } from '../../testing/spy';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TeamSummary } from '@gameplan/types';
import { ActiveTeamService } from './active-team.service';
import { ApiClientService } from './api-client.service';
import { TeamBrandService } from './team-brand.service';

const team = (teamId: string, theme?: TeamSummary['theme']): TeamSummary => ({
  teamId,
  name: teamId,
  timeZone: 'America/New_York',
  role: 'player',
  theme,
});

describe('ActiveTeamService', () => {
  let api: SpyObj<ApiClientService>;
  let brand: SpyObj<TeamBrandService>;
  let service: ActiveTeamService;

  beforeEach(() => {
    api = createSpyObj<ApiClientService>(
      'ApiClientService',
      ['listTeams', 'restoreTeamId', 'getTeamId'],
      { selectedTeamId: signal<string | undefined>(undefined) },
    );
    brand = createSpyObj<TeamBrandService>('TeamBrandService', [
      'select',
      'clear',
      'rememberLogo',
    ]);
    brand.select.mockResolvedValue(undefined);
    brand.clear.mockResolvedValue(undefined);
    brand.rememberLogo.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClientService, useValue: api },
        { provide: TeamBrandService, useValue: brand },
      ],
    });
    service = TestBed.inject(ActiveTeamService);
  });

  it('clears branding when the caller has no teams', async () => {
    api.listTeams.mockResolvedValue([]);
    api.restoreTeamId.mockResolvedValue(undefined);
    api.getTeamId.mockReturnValue(undefined);

    await service.refresh();

    expect(service.teams()).toEqual([]);
    expect(brand.clear).toHaveBeenCalled();
    expect(brand.select).not.toHaveBeenCalled();
  });

  it('selects the first team when the stored id is missing', async () => {
    const teams = [team('a', { logoKey: 'logo-a' }), team('b')];
    api.listTeams.mockResolvedValue(teams);
    api.restoreTeamId.mockResolvedValue(undefined);
    api.getTeamId.mockReturnValue(undefined);

    await service.refresh();

    expect(brand.select).toHaveBeenCalledWith('a', { logoKey: 'logo-a' });
    expect(brand.rememberLogo).toHaveBeenCalledWith('logo-a');
  });

  it('keeps a valid stored team without re-selecting', async () => {
    const teams = [team('a'), team('b', { primary: '#111111' })];
    api.listTeams.mockResolvedValue(teams);
    api.restoreTeamId.mockResolvedValue('b');
    api.getTeamId.mockReturnValue('b');
    api.selectedTeamId.set('b');

    await service.refresh();

    expect(brand.select).not.toHaveBeenCalled();
    expect(service.active()?.teamId).toBe('b');
  });

  it('selects a different team and ignores a no-op select', async () => {
    service.teams.set([team('a'), team('b', { accent: '#abc' })]);
    api.getTeamId.mockReturnValue('a');
    api.selectedTeamId.set('a');

    await service.select('b');
    expect(brand.select).toHaveBeenCalledWith('b', { accent: '#abc' });

    brand.select.mockClear();
    api.getTeamId.mockReturnValue('b');
    await service.select('b');
    expect(brand.select).not.toHaveBeenCalled();
  });

  it('clears teams and branding', async () => {
    service.teams.set([team('a')]);
    await service.clear();
    expect(service.teams()).toEqual([]);
    expect(brand.clear).toHaveBeenCalled();
  });
});
