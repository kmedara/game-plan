/**
 * Application routes: auth outside the shell; signed-in pages under the layout.
 */

import { Routes } from '@angular/router';
import { authGuard, completeProfileGuard } from './core/auth-guard';
import { AuthPageComponent } from './features/auth';
import { CompleteProfilePageComponent } from './features/complete-profile';
import { ChatThreadPageComponent, ChatsPageComponent } from './features/chats';
import { SchedulePageComponent } from './features/schedule';
import { InvitePageComponent } from './features/invite';
import { MemberProfilePageComponent } from './features/member-profile';
import { ProfilePageComponent } from './features/profile';
import { TeamAdminPageComponent, TeamsPageComponent } from './features/teams';
import { AppLayoutComponent } from './layout/app-layout';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'teams' },
  {
    path: 'login',
    component: AuthPageComponent,
  },
  {
    path: 'register',
    redirectTo: 'login',
  },
  {
    path: 'complete-profile',
    component: CompleteProfilePageComponent,
    canActivate: [authGuard],
  },
  {
    path: '',
    component: AppLayoutComponent,
    canActivate: [authGuard, completeProfileGuard],
    children: [
      {
        path: 'schedule',
        component: SchedulePageComponent,
        data: { titleKey: 'title.schedule' },
      },
      {
        path: 'chats',
        component: ChatsPageComponent,
        data: { titleKey: 'title.chats' },
      },
      {
        path: 'chats/:chatId',
        component: ChatThreadPageComponent,
      },
      {
        path: 'teams',
        component: TeamsPageComponent,
        data: { titleKey: 'title.teams' },
      },
      {
        path: 'profile',
        component: ProfilePageComponent,
        data: { titleKey: 'title.profile' },
      },
      {
        path: 'teams/:teamId',
        component: TeamAdminPageComponent,
      },
      {
        path: 'teams/:teamId/admin',
        component: TeamAdminPageComponent,
      },
      {
        path: 'teams/:teamId/members/:userId',
        component: MemberProfilePageComponent,
        data: { titleKey: 'title.profile' },
      },
      {
        path: 'invite/:code',
        component: InvitePageComponent,
        data: { titleKey: 'title.invite' },
      },
    ],
  },
  { path: '**', redirectTo: 'teams' },
];
