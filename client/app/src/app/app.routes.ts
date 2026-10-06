/**
 * Application routes: auth, schedule home, chats, and teams.
 */

import { Routes } from '@angular/router';
import { authGuard, completeProfileGuard } from './core/auth-guard';
import { AuthPageComponent } from './features/auth';
import { CompleteProfilePageComponent } from './features/complete-profile';
import { ChatThreadPageComponent, ChatsPageComponent } from './features/chats';
import { SchedulePageComponent } from './features/schedule';
import { TeamAdminPageComponent, TeamsPageComponent } from './features/teams';

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
    path: 'schedule',
    component: SchedulePageComponent,
    canActivate: [authGuard, completeProfileGuard],
  },
  {
    path: 'chats',
    component: ChatsPageComponent,
    canActivate: [authGuard, completeProfileGuard],
  },
  {
    path: 'chats/:chatId',
    component: ChatThreadPageComponent,
    canActivate: [authGuard, completeProfileGuard],
  },
  {
    path: 'teams',
    component: TeamsPageComponent,
    canActivate: [authGuard, completeProfileGuard],
  },
  {
    path: 'teams/:teamId/admin',
    component: TeamAdminPageComponent,
    canActivate: [authGuard, completeProfileGuard],
  },
  { path: '**', redirectTo: 'teams' },
];
