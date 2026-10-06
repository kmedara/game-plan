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
        data: { title: 'Schedule' },
      },
      {
        path: 'chats',
        component: ChatsPageComponent,
        data: { title: 'Chats' },
      },
      {
        path: 'chats/:chatId',
        component: ChatThreadPageComponent,
      },
      {
        path: 'teams',
        component: TeamsPageComponent,
        data: { title: 'Teams' },
      },
      {
        path: 'profile',
        component: ProfilePageComponent,
        data: { title: 'Profile' },
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
        path: 'invite/:code',
        component: InvitePageComponent,
        data: { title: 'Invite' },
      },
    ],
  },
  { path: '**', redirectTo: 'teams' },
];
