/**
 * Profile photo and the positions the signed-in user plays on each team.
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { TeamSummary, UserProfile } from '@gameplan/types';
import { ApiClientService } from '../core/api-client.service';
import { ActiveTeamService } from '../core/active-team.service';
import { TranslocoPipe } from '@jsverse/transloco';
import { ThemeToggleComponent } from '../core/theme-toggle';
import { Router } from '@angular/router';

/** Image types accepted for a profile photo. */
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Largest photo the profile page will upload. */
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Initials shown when the profile has no photo.
 *
 * @param displayName - The profile display name.
 * @returns Up to two uppercase letters.
 */
const initialsOf = (displayName: string): string => {
  const parts = displayName.trim().split(/\s+/u).filter((part) => part.length > 0);
  const letters = parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase());
  const initials = letters.join('');
  return initials.length > 0 ? initials : '?';
};

/**
 * Turns a positions API error into a sentence.
 *
 * @param code - The error code from the API client.
 * @returns Text for the team card.
 */
const positionMessage = (code: string): string => {
  if (code === 'too_many_positions') return 'errors.position.tooMany';
  if (code === 'invalid_body') return 'errors.position.invalid';
  return 'errors.position.saveFailed';
};

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ThemeToggleComponent,
    TranslocoPipe,
  ],
  templateUrl: './profile.html',
})
export class ProfilePageComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly activeTeam = inject(ActiveTeamService);
  private readonly router = inject(Router);
  private readonly positionControls = new Map<string, FormControl<string>>();

  readonly profile = signal<UserProfile | undefined>(undefined);
  readonly teams = signal<TeamSummary[]>([]);
  readonly photoUrl = signal<string | undefined>(undefined);
  readonly uploading = signal(false);
  readonly photoError = signal<string | undefined>(undefined);
  readonly phoneControl = new FormControl('', { nonNullable: true });
  readonly savingPhone = signal(false);
  readonly phoneError = signal<string | undefined>(undefined);
  readonly positionError = signal<Record<string, string>>({});
  readonly initials = computed(() => initialsOf(this.profile()?.displayName ?? ''));

  ngOnInit(): void {
    void this.load();
  }

  /** Clears the session and returns to login. */
  async logout(): Promise<void> {
    await this.activeTeam.clear();
    await this.api.logout();
    await this.router.navigateByUrl('/login');
  }

  /**
   * Returns the add-position field for a team, creating it on first use.
   *
   * @param teamId - The team id.
   * @returns The text control for that team.
   */
  positionControl(teamId: string): FormControl<string> {
    const existing = this.positionControls.get(teamId);
    if (existing !== undefined) return existing;
    const control = new FormControl('', { nonNullable: true });
    this.positionControls.set(teamId, control);
    return control;
  }

  /**
   * Uploads a chosen image and stores its object key on the profile.
   *
   * @param event - The file input change event.
   */
  async onPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    if (!PHOTO_TYPES.has(file.type)) {
      this.photoError.set('errors.profile.badImageType');
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      this.photoError.set('errors.profile.imageTooLarge');
      return;
    }

    this.uploading.set(true);
    this.photoError.set(undefined);
    try {
      const presign = await this.api.presignUpload(file.type, file.size);
      const uploaded = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      });
      if (!uploaded.ok) throw new Error('upload_failed');
      const profile = await this.api.updateProfile({ photoKey: presign.objectKey });
      this.profile.set(profile);
      await this.loadPhoto(profile.photoKey);
    } catch {
      this.photoError.set('errors.profile.savePhotoFailed');
    } finally {
      this.uploading.set(false);
    }
  }

  /** Removes the profile photo. */
  async removePhoto(): Promise<void> {
    this.uploading.set(true);
    this.photoError.set(undefined);
    try {
      const profile = await this.api.updateProfile({ photoKey: null });
      this.profile.set(profile);
      this.photoUrl.set(undefined);
    } catch {
      this.photoError.set('errors.profile.removePhotoFailed');
    } finally {
      this.uploading.set(false);
    }
  }

  /** Saves or clears the contact phone teammates can see. */
  async savePhone(): Promise<void> {
    const next = this.phoneControl.value.trim();
    this.savingPhone.set(true);
    this.phoneError.set(undefined);
    try {
      const profile = await this.api.updateProfile({
        phoneNumber: next.length > 0 ? next : null,
      });
      this.profile.set(profile);
      this.phoneControl.setValue(profile.phoneNumber ?? '');
    } catch (err) {
      const code = err instanceof Error ? err.message : 'save_failed';
      this.phoneError.set(
        code === 'invalid_body'
          ? 'errors.profile.badPhone'
          : 'errors.profile.savePhoneFailed',
      );
    } finally {
      this.savingPhone.set(false);
    }
  }

  /**
   * Adds the typed position to a team.
   *
   * @param team - The team whose positions change.
   */
  async addPosition(team: TeamSummary): Promise<void> {
    const control = this.positionControl(team.teamId);
    const next = control.value.trim();
    if (next.length === 0) return;
    const saved = await this.savePositions(team.teamId, [...(team.positions ?? []), next]);
    if (saved) control.setValue('');
  }

  /**
   * Removes one position from a team.
   *
   * @param team - The team whose positions change.
   * @param position - The position label to drop.
   */
  async removePosition(team: TeamSummary, position: string): Promise<void> {
    const next = (team.positions ?? []).filter((item) => item !== position);
    await this.savePositions(team.teamId, next);
  }

  private async load(): Promise<void> {
    try {
      const [profile, teams] = await Promise.all([this.api.getMe(), this.api.listTeams()]);
      this.profile.set(profile);
      this.phoneControl.setValue(profile.phoneNumber ?? '');
      this.teams.set(teams);
      await this.loadPhoto(profile.photoKey);
    } catch {
      this.photoError.set('errors.profile.loadFailed');
    }
  }

  /**
   * Loads a display URL for the stored photo key.
   *
   * @param photoKey - The media object key, when the profile has a photo.
   */
  private async loadPhoto(photoKey: string | undefined): Promise<void> {
    if (photoKey === undefined) {
      this.photoUrl.set(undefined);
      return;
    }
    try {
      const download = await this.api.presignDownload(photoKey);
      this.photoUrl.set(download.downloadUrl);
    } catch {
      this.photoUrl.set(undefined);
    }
  }

  /**
   * Saves a team's positions and refreshes that card.
   *
   * @param teamId - The team id.
   * @param positions - The replacement list.
   * @returns `true` when the save succeeded.
   */
  private async savePositions(teamId: string, positions: string[]): Promise<boolean> {
    this.positionError.update((current) => {
      const next = { ...current };
      delete next[teamId];
      return next;
    });
    try {
      const team = await this.api.setPositions(teamId, positions);
      this.teams.update((teams) =>
        teams.map((item) => (item.teamId === team.teamId ? team : item)),
      );
      return true;
    } catch (err) {
      const code = err instanceof Error ? err.message : 'save_failed';
      this.positionError.update((current) => ({ ...current, [teamId]: positionMessage(code) }));
      return false;
    }
  }
}
