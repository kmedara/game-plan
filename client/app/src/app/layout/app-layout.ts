/**
 * Authenticated shell: page header, child route content, and bottom navigation.
 */

import { Component, OnInit, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ActiveTeamService } from '../core/active-team.service';
import { ApiClientService } from '../core/api-client.service';
import { TeamBrandService } from '../core/team-brand.service';

/**
 * Reads `data.titleKey` from the deepest activated child route.
 *
 * @param route - The layout's activated route.
 * @returns The translation key, or `undefined` when unset.
 */
export const childTitleKey = (route: ActivatedRoute): string | undefined => {
  let current: ActivatedRoute | null = route;
  while (current.firstChild) current = current.firstChild;
  const titleKey = current.snapshot?.data?.['titleKey'];
  return typeof titleKey === 'string' && titleKey.length > 0 ? titleKey : undefined;
};

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslocoPipe,
  ],
  templateUrl: './app-layout.html',
  host: { class: 'app-layout' },
})
export class AppLayoutComponent implements OnInit {
  readonly api = inject(ApiClientService);
  readonly activeTeam = inject(ActiveTeamService);
  readonly teamBrand = inject(TeamBrandService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly i18n = inject(TranslocoService);

  readonly title = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => {
        const key = childTitleKey(this.route);
        return key === undefined ? undefined : this.i18n.translate(key);
      }),
    ),
    {
      initialValue: (() => {
        const key = childTitleKey(this.route);
        return key === undefined ? undefined : this.i18n.translate(key);
      })(),
    },
  );

  ngOnInit(): void {
    void this.activeTeam.refresh();
  }

  /**
   * Switches the active team from the header picker.
   *
   * @param teamId - The selected team id.
   */
  async onTeamChange(teamId: string): Promise<void> {
    await this.activeTeam.select(teamId);
  }
}
