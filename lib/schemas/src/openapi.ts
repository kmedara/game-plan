/**
 * OpenAPI 3.1 description of the HTTP API, served by the local Swagger page.
 *
 * Routes are matched by hand in each `functions/<area>/src/handler.ts`, so this list is
 * kept in sync by hand. Zod schemas are converted to JSON Schema for the document.
 */

import {
  acceptedInviteSchema,
  approveJoinRequestBodySchema,
  assignRoleBodySchema,
  createInviteBodySchema,
  createTeamBodySchema,
  invitePreviewSchema,
  approvedJoinRequestSchema,
  joinRequestCreatedSchema,
  joinRequestListSchema,
  rolePermissionsResponseSchema,
  searchTeamDirectoryQuerySchema,
  teamDirectoryPageSchema,
  teamInviteListSchema,
  teamMemberListSchema,
  teamMemberProfileSchema,
  teamInviteSchema,
  teamListSchema,
  teamSummarySchema,
  updatePositionsBodySchema,
  updateRolePermissionsBodySchema,
  updateTeamBodySchema,
} from './teams.js';
import {
  completeProfileBodySchema,
  createGuardianInviteBodySchema,
  guardianLinkSchema,
  confirmationRequiredSchema,
  confirmRegistrationBodySchema,
  errorBodySchema,
  loginBodySchema,
  oauthExchangeBodySchema,
  oauthExchangeResponseSchema,
  refreshBodySchema,
  registerBodySchema,
  resendConfirmationBodySchema,
  sessionTokensSchema,
  socketTicketSchema,
  updateProfileBodySchema,
  userProfileSchema,
} from './auth.js';
import {
  acceptFixtureBodySchema,
  calendarFeedSchema,
  createEventBodySchema,
  eventResponseSchema,
  fixtureListSchema,
  fixtureSchema,
  carpoolClaimBodySchema,
  carpoolOfferBodySchema,
  carpoolQuerySchema,
  carpoolResponseSchema,
  lineupBodySchema,
  lineupQuerySchema,
  lineupResponseSchema,
  rsvpBodySchema,
  rsvpResponseSchema,
  scheduleListSchema,
  exceptionEventBodySchema,
  occurrenceTargetSchema,
  proposeFixtureBodySchema,
  scheduleWindowQuerySchema,
  updateEventBodySchema,
  updateFixtureBodySchema,
} from './schedule.js';
import {
  chatListSchema,
  chatMessageSchema,
  chatSummarySchema,
  createPollBodySchema,
  createPrivateChatBodySchema,
  pollTallySchema,
  pollVoteBodySchema,
  createTeamChannelBodySchema,
  messageHistoryQuerySchema,
  messagePageSchema,
  searchUsersQuerySchema,
  sendMessageBodySchema,
} from './chat.js';
import {
  deviceRegistrationSchema,
  presignDownloadQuerySchema,
  presignDownloadResponseSchema,
  presignUploadBodySchema,
  presignUploadResponseSchema,
  registerDeviceBodySchema,
} from './media.js';
import {
  placeDetailsSchema,
  placesAutocompleteQuerySchema,
  placesAutocompleteResponseSchema,
  placesMapQuerySchema,
  placesResolveQuerySchema,
  placesReverseQuerySchema,
} from './places.js';
import {
  chargeDetailSchema,
  chargeListSchema,
  chargeSchema,
  createChargeBodySchema,
  dueSchema,
  myDuesSchema,
  paymentAccountSchema,
  paymentRedirectSchema,
  paymentReturnBodySchema,
  paymentReturnQuerySchema,
  updateDueBodySchema,
} from './payments.js';
import {
  billingPortalBodySchema,
  billingReturnQuerySchema,
  teamBillingSchema,
  teamCheckoutBodySchema,
} from './plans.js';
import { preferencesSchema, updatePreferencesBodySchema } from './preferences.js';
import { claimSignupBodySchema, putSignupsBodySchema, signupsQuerySchema, signupsResponseSchema } from './signups.js';
import { medicalInfoBodySchema, medicalInfoSchema, medicalPeopleSchema, memberMedicalSchema } from './medical.js';
import { z, type ZodType } from './zod.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** One operation in the compact route table below. */
type RouteSpec = {
  summary: string;
  body?: ZodType;
  query?: ZodType;
  response?: ZodType;
  /** Overrides the area default for bearer-token security. */
  secured?: boolean;
  /** The route answers with a `302` redirect instead of JSON. */
  redirect?: boolean;
};

type AreaSpec = {
  description: string;
  /** Whether the gateway requires a Cognito access token for this area. */
  secured: boolean;
  paths: Record<string, Partial<Record<Method, RouteSpec>>>;
};

/** Convert a Zod schema to a plain JSON Schema object for OpenAPI. */
const toJsonSchema = (schema: ZodType): object => {
  const converted = zodToJsonSchema(schema, { $refStrategy: 'none' });
  const { $schema: _schema, ...rest } = converted as Record<string, unknown>;
  return rest;
};

/** Areas exposed over HTTP; socket and fanout carry WebSocket and internal traffic only. */
const AREAS: Record<string, AreaSpec> = {
  identity: {
    description: 'Register, log in, refresh, and the Cognito Hosted UI redirects.',
    secured: false,
    paths: {
      '/identity/register': {
        post: {
          summary: 'Create an account. Cognito waits for the emailed confirmation code.',
          body: registerBodySchema,
          response: z.union([sessionTokensSchema, confirmationRequiredSchema]),
        },
      },
      '/identity/confirm': {
        post: {
          summary: 'Confirm a signup with the emailed code',
          body: confirmRegistrationBodySchema,
        },
      },
      '/identity/confirm/resend': {
        post: {
          summary: 'Send another signup confirmation code',
          body: resendConfirmationBodySchema,
        },
      },
      '/identity/login': {
        post: { summary: 'Log in with email and password', body: loginBodySchema, response: sessionTokensSchema },
      },
      '/identity/refresh': {
        post: {
          summary: 'Exchange a refresh token (body or cookie) for a new access token',
          body: refreshBodySchema,
          response: sessionTokensSchema,
        },
      },
      '/identity/logout': { post: { summary: 'Clear the refresh cookie' } },
      '/identity/me': {
        get: { summary: 'Current user profile', response: userProfileSchema, secured: true },
      },
      '/identity/socket-ticket': {
        post: {
          summary: 'Issue a one-time WebSocket connect ticket',
          response: socketTicketSchema,
          secured: true,
        },
      },
      '/identity/profile': {
        patch: {
          summary: 'Update the profile photo and/or phone number',
          body: updateProfileBodySchema,
          response: userProfileSchema,
          secured: true,
        },
      },
      '/identity/medical': {
        get: {
          summary: "Emergency and medical info for the caller and each child they are a guardian of",
          response: medicalPeopleSchema,
          secured: true,
        },
      },
      '/identity/medical/{userId}': {
        put: {
          summary: "Replace an adult's own, or a child's, emergency and medical info",
          body: medicalInfoBodySchema,
          response: medicalInfoSchema,
          secured: true,
        },
      },
      '/identity/me/preferences': {
        get: { summary: "The caller's settings, such as reminder times", response: preferencesSchema, secured: true },
        patch: {
          summary: 'Change some settings',
          body: updatePreferencesBodySchema,
          response: preferencesSchema,
          secured: true,
        },
      },
      '/identity/guardians': {
        post: {
          summary: 'Invite an adult guardian by email',
          body: createGuardianInviteBodySchema,
          response: guardianLinkSchema,
          secured: true,
        },
      },
      '/identity/guardians/{inviteId}/accept': {
        post: {
          summary: 'Accept a guardian invite',
          response: guardianLinkSchema,
          secured: true,
        },
      },
      '/identity/guardians/{userId}': {
        delete: { summary: 'Remove a guardian link', secured: true },
      },
      '/identity/profile/complete': {
        post: {
          summary: 'Finish a social-login profile',
          body: completeProfileBodySchema,
          response: userProfileSchema,
          secured: true,
        },
      },
      '/identity/oauth/login': {
        get: {
          summary: 'Redirect to the Cognito Hosted UI',
          query: z.object({
            returnTo: z.string().optional(),
            delivery: z.enum(['native']).optional(),
          }),
          redirect: true,
        },
      },
      '/identity/oauth/callback': {
        get: {
          summary: 'Cognito Hosted UI callback',
          query: z.object({
            code: z.string().optional(),
            state: z.string().optional(),
            error: z.string().optional(),
          }),
          redirect: true,
        },
      },
      '/identity/oauth/exchange': {
        post: {
          summary: 'Redeem a native OAuth handoff code for a session',
          body: oauthExchangeBodySchema,
          response: oauthExchangeResponseSchema,
        },
      },
      '/identity/oauth/logout': {
        get: {
          summary: 'Log out of the Cognito Hosted UI',
          query: z.object({ returnTo: z.string().optional() }),
          redirect: true,
        },
      },
    },
  },
  teams: {
    description: 'Teams, roster, invites, join requests, roles, and the permission matrix.',
    secured: true,
    paths: {
      '/teams': {
        get: { summary: "List the caller's teams", response: teamListSchema },
        post: { summary: 'Create a team', body: createTeamBodySchema, response: teamSummarySchema },
      },
      '/teams/directory': {
        get: {
          summary: 'Search the team directory by name',
          query: searchTeamDirectoryQuerySchema,
          response: teamDirectoryPageSchema,
        },
      },
      '/teams/invite/{code}': {
        get: { summary: 'Look up an invite code', response: invitePreviewSchema },
      },
      '/teams/invite/{code}/accept': {
        post: { summary: 'Accept an invite', response: acceptedInviteSchema },
      },
      '/teams/{teamId}': {
        get: { summary: 'Get a team', response: teamSummarySchema },
        patch: {
          summary: 'Update the name, time zone, location, or theme',
          body: updateTeamBodySchema,
          response: teamSummarySchema,
        },
      },
      '/teams/{teamId}/positions': {
        put: {
          summary: "Replace the caller's positions on the team",
          body: updatePositionsBodySchema,
          response: teamSummarySchema,
        },
      },
      '/teams/{teamId}/members': {
        get: { summary: 'List the roster', response: teamMemberListSchema },
      },
      '/teams/{teamId}/members/{userId}/medical': {
        get: {
          summary: "A member's emergency info for staff with view_medical_info (logged)",
          response: memberMedicalSchema,
        },
      },
      '/teams/{teamId}/members/{userId}': {
        get: { summary: 'Get one roster member profile', response: teamMemberProfileSchema },
        patch: { summary: "Change a member's roles", body: assignRoleBodySchema },
      },
      '/teams/{teamId}/permissions': {
        get: { summary: 'Get the role-permission matrix', response: rolePermissionsResponseSchema },
        put: {
          summary: 'Replace the role-permission matrix',
          body: updateRolePermissionsBodySchema,
          response: rolePermissionsResponseSchema,
        },
      },
      '/teams/{teamId}/invites': {
        get: { summary: 'List invite codes', response: teamInviteListSchema },
        post: {
          summary: 'Create an invite code',
          body: createInviteBodySchema,
          response: teamInviteSchema,
        },
      },
      '/teams/{teamId}/invites/{role}': {
        delete: { summary: 'Delete the invite code for a role' },
      },
      '/teams/{teamId}/join-requests': {
        get: { summary: 'List pending join requests', response: joinRequestListSchema },
        post: { summary: 'Ask to join the team', response: joinRequestCreatedSchema },
      },
      '/teams/{teamId}/join-requests/{requestId}/approve': {
        post: {
          summary: 'Approve a join request',
          body: approveJoinRequestBodySchema,
          response: approvedJoinRequestSchema,
        },
      },
      '/teams/{teamId}/join-requests/{requestId}/reject': {
        post: { summary: 'Reject a join request' },
      },
    },
  },
  schedule: {
    description: 'Events, recurrence, and RSVPs.',
    secured: true,
    paths: {
      '/schedule/teams/{teamId}/signups': {
        get: { summary: 'Volunteer sign-ups for one occurrence', query: signupsQuerySchema, response: signupsResponseSchema },
        put: {
          summary: 'Replace the sign-up slots (manage_events)',
          body: putSignupsBodySchema,
          response: signupsResponseSchema,
        },
      },
      '/schedule/teams/{teamId}/signups/claim': {
        put: {
          summary: 'Take a place on a slot, or give it up; a guardian may act for a child',
          body: claimSignupBodySchema,
          response: signupsResponseSchema,
        },
      },
      '/schedule/feed': {
        get: { summary: "The caller's private calendar link, created on first use", response: calendarFeedSchema },
      },
      '/schedule/feed/rotate': {
        post: { summary: 'Replace the calendar link; the old one stops working', response: calendarFeedSchema },
      },
      '/schedule/feeds/{file}': {
        get: {
          summary: 'iCalendar feed for `<token>.ics` (text/calendar, no bearer token; optional ?teams=a,b)',
          secured: false,
        },
      },
      '/schedule/teams/{teamId}': {
        get: {
          summary: 'Expanded event occurrences in a time window',
          query: scheduleWindowQuerySchema,
          response: scheduleListSchema,
        },
      },
      '/schedule/teams/{teamId}/events': {
        post: { summary: 'Create an event', body: createEventBodySchema, response: eventResponseSchema },
      },
      '/schedule/teams/{teamId}/events/{eventId}': {
        get: { summary: 'Get an event', response: eventResponseSchema },
        patch: { summary: 'Update an event', body: updateEventBodySchema, response: eventResponseSchema },
        delete: { summary: 'Delete an event and its split-off dates' },
      },
      '/schedule/teams/{teamId}/events/{eventId}/occurrences': {
        post: {
          summary: 'Change one date in a series',
          body: exceptionEventBodySchema,
          response: eventResponseSchema,
        },
        delete: { summary: 'Cancel one date in a series', body: occurrenceTargetSchema },
      },
      '/schedule/teams/{teamId}/rsvps': {
        put: { summary: 'Set an RSVP for one occurrence', body: rsvpBodySchema, response: rsvpResponseSchema },
      },
      '/schedule/teams/{teamId}/lineup': {
        get: {
          summary: 'Read a game lineup, or the previous lineup in the series',
          query: lineupQuerySchema,
          response: lineupResponseSchema,
        },
        put: { summary: 'Replace a game lineup', body: lineupBodySchema, response: lineupResponseSchema },
      },
      '/schedule/teams/{teamId}/carpool': {
        get: {
          summary: 'Read rides for one event date',
          query: carpoolQuerySchema,
          response: carpoolResponseSchema,
        },
        put: {
          summary: 'Offer or clear the caller’s seats',
          body: carpoolOfferBodySchema,
          response: carpoolResponseSchema,
        },
      },
      '/schedule/teams/{teamId}/carpool/claim': {
        put: {
          summary: 'Claim or leave one driver’s car',
          body: carpoolClaimBodySchema,
          response: carpoolResponseSchema,
        },
      },
      '/schedule/teams/{teamId}/events/{eventId}/fixture': {
        post: {
          summary: 'Propose this game to another club',
          body: proposeFixtureBodySchema,
          response: fixtureSchema,
        },
      },
      '/schedule/teams/{teamId}/fixtures': {
        get: { summary: 'Pending invites and linked fixtures', response: fixtureListSchema },
      },
      '/schedule/fixtures/{fixtureId}/accept': {
        post: {
          summary: 'Accept a proposed fixture',
          body: acceptFixtureBodySchema,
          response: fixtureSchema,
        },
      },
      '/schedule/fixtures/{fixtureId}/decline': {
        post: { summary: 'Decline a proposed fixture' },
      },
      '/schedule/fixtures/{fixtureId}': {
        patch: {
          summary: 'Change the shared start or venue',
          body: updateFixtureBodySchema,
          response: fixtureSchema,
        },
        delete: { summary: 'Unlink both clubs and keep each game' },
      },
    },
  },
  chat: {
    description: 'Team channels, private chats, and messages.',
    secured: true,
    paths: {
      '/chat': { get: { summary: "List the caller's chats", response: chatListSchema } },
      '/chat/channels': {
        post: { summary: 'Create a team channel', body: createTeamChannelBodySchema, response: chatSummarySchema },
      },
      '/chat/private': {
        post: { summary: 'Create a private chat', body: createPrivateChatBodySchema, response: chatSummarySchema },
      },
      '/chat/users/search': {
        get: { summary: 'Find a user by exact email', query: searchUsersQuerySchema },
      },
      '/chat/{chatId}/messages': {
        get: {
          summary: 'Message history, newest first',
          query: messageHistoryQuerySchema,
          response: messagePageSchema,
        },
        post: { summary: 'Send a message', body: sendMessageBodySchema, response: chatMessageSchema },
      },
      '/chat/{chatId}/polls': {
        post: { summary: 'Post a poll as a message', body: createPollBodySchema, response: chatMessageSchema },
      },
      '/chat/{chatId}/polls/{messageId}/vote': {
        put: {
          summary: "Set the caller's choices; an empty list takes the vote back",
          body: pollVoteBodySchema,
          response: pollTallySchema,
        },
      },
    },
  },
  media: {
    description: 'Signed upload and download URLs, and push-notification devices.',
    secured: true,
    paths: {
      '/media/presign-upload': {
        post: {
          summary: 'Get a signed upload URL',
          body: presignUploadBodySchema,
          response: presignUploadResponseSchema,
        },
      },
      '/media/presign-download': {
        get: {
          summary: 'Get a signed download URL',
          query: presignDownloadQuerySchema,
          response: presignDownloadResponseSchema,
        },
      },
      '/media/devices/{deviceId}': {
        put: {
          summary: 'Register a device for push notifications',
          body: registerDeviceBodySchema,
          response: deviceRegistrationSchema,
        },
        delete: { summary: 'Remove a device' },
      },
    },
  },
  places: {
    description: 'Place autocomplete, details, and map previews (Google Places proxied by the API).',
    secured: true,
    paths: {
      '/places/autocomplete': {
        get: {
          summary: 'Autocomplete place suggestions',
          query: placesAutocompleteQuerySchema,
          response: placesAutocompleteResponseSchema,
        },
      },
      '/places/resolve': {
        get: {
          summary: 'Resolve a place id to a label and coordinates',
          query: placesResolveQuerySchema,
          response: placeDetailsSchema,
        },
      },
      '/places/reverse': {
        get: {
          summary: 'Reverse-geocode coordinates to a label',
          query: placesReverseQuerySchema,
          response: placeDetailsSchema,
        },
      },
      '/places/map': {
        get: {
          summary: 'Static map preview image for coordinates',
          query: placesMapQuerySchema,
        },
      },
    },
  },
  payments: {
    description: 'Team dues: Stripe Connect onboarding, charges, member dues, and checkout.',
    secured: true,
    paths: {
      '/payments/teams/{teamId}/account': {
        get: { summary: "The team's Stripe account status", response: paymentAccountSchema },
      },
      '/payments/teams/{teamId}/account/link': {
        post: {
          summary: 'Start or resume Stripe onboarding',
          body: paymentReturnBodySchema,
          response: paymentRedirectSchema,
        },
      },
      '/payments/teams/{teamId}/charges': {
        get: { summary: 'Charges with paid and outstanding totals', response: chargeListSchema },
        post: { summary: 'Charge members', body: createChargeBodySchema, response: chargeSchema },
      },
      '/payments/teams/{teamId}/charges/{chargeId}': {
        get: { summary: 'One charge and every member due', response: chargeDetailSchema },
      },
      '/payments/teams/{teamId}/charges/{chargeId}/dues/{memberId}': {
        patch: {
          summary: 'Mark a due paid offline, waived, or unpaid',
          body: updateDueBodySchema,
          response: dueSchema,
        },
      },
      '/payments/teams/{teamId}/charges/{chargeId}/dues/{memberId}/checkout': {
        post: {
          summary: 'Open a Stripe Checkout page for a due',
          body: paymentReturnBodySchema,
          response: paymentRedirectSchema,
        },
      },
      '/payments/me/dues': {
        get: { summary: 'Dues the caller owes, for themselves or their children', response: myDuesSchema },
      },
      '/payments/return': {
        get: {
          summary: 'Where Stripe sends the browser back; redirects to the app or website',
          query: paymentReturnQuerySchema,
          secured: false,
          redirect: true,
        },
      },
      '/payments/webhook': {
        post: { summary: 'Stripe webhook (Stripe-Signature header, no bearer token)', secured: false },
      },
    },
  },
  billing: {
    description: 'Paid plans through Stripe Billing: plan status, checkout, and the billing portal.',
    secured: true,
    paths: {
      '/billing/teams/{teamId}': {
        get: { summary: "The team's plan", response: teamBillingSchema },
      },
      '/billing/teams/{teamId}/checkout': {
        post: {
          summary: 'Open Stripe Checkout for the premium plan',
          body: teamCheckoutBodySchema,
          response: paymentRedirectSchema,
        },
      },
      '/billing/teams/{teamId}/portal': {
        post: {
          summary: 'Open the Stripe billing portal',
          body: billingPortalBodySchema,
          response: paymentRedirectSchema,
        },
      },
      '/billing/return': {
        get: {
          summary: 'Where Stripe sends the browser back; redirects to the app or website',
          query: billingReturnQuerySchema,
          secured: false,
          redirect: true,
        },
      },
      '/billing/webhook': {
        post: { summary: 'Stripe Billing webhook (Stripe-Signature header, no bearer token)', secured: false },
      },
    },
  },
};

const jsonContent = (schema: ZodType | object) => ({
  'application/json': {
    schema: schema instanceof z.ZodType ? toJsonSchema(schema) : schema,
  },
});

/**
 * Builds the OpenAPI parameter list from `{name}` path segments and a query schema.
 *
 * @param path - An OpenAPI path template such as `/teams/{teamId}`.
 * @param query - An optional Zod object schema for the query string.
 * @returns Path parameters first, then query parameters.
 */
const parametersOf = (path: string, query: ZodType | undefined): object[] => {
  const pathParams = [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  if (query === undefined) return pathParams;

  const jsonSchema = toJsonSchema(query) as {
    required?: string[];
    properties?: Record<string, object>;
  };
  const required = new Set(jsonSchema.required ?? []);
  const queryParams = Object.entries(jsonSchema.properties ?? {}).map(([name, schema]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema,
  }));
  return [...pathParams, ...queryParams];
};

/**
 * Converts one compact route entry into an OpenAPI operation object.
 *
 * @param tag - The area tag shown as a section in Swagger UI.
 * @param area - The area entry, for its default security.
 * @param path - The path template.
 * @param route - The compact route entry.
 * @returns An OpenAPI operation.
 */
const operationOf = (tag: string, area: AreaSpec, path: string, route: RouteSpec): object => {
  const success = route.redirect
    ? { '302': { description: 'Redirect' } }
    : { '2XX': { description: 'Success', content: jsonContent(route.response ?? { type: 'object' }) } };
  const parameters = parametersOf(path, route.query);
  return {
    tags: [tag],
    summary: route.summary,
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(route.body ? { requestBody: { required: true, content: jsonContent(route.body) } } : {}),
    responses: { ...success, '4XX': { description: 'Client error', content: jsonContent(errorBodySchema) } },
    ...((route.secured ?? area.secured) ? { security: [{ bearer: [] }] } : {}),
  };
};

const paths: Record<string, Record<string, object>> = {};
for (const [tag, area] of Object.entries(AREAS)) {
  paths[`/${tag}/health`] = {
    get: operationOf(tag, area, `/${tag}/health`, { summary: 'Health check', secured: false }),
  };
  for (const [path, methods] of Object.entries(area.paths)) {
    paths[path] = Object.fromEntries(
      Object.entries(methods).map(([method, route]) => [method, operationOf(tag, area, path, route)]),
    );
  }
}

/** The OpenAPI document for every HTTP route, relative to the current origin. */
export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'GamePlan API',
    version: '0.0.0',
    description: 'HTTP routes for each product area. Locally, requests go through the proxy.',
  },
  servers: [{ url: '/' }],
  tags: Object.entries(AREAS).map(([name, area]) => ({ name, description: area.description })),
  paths,
  components: {
    securitySchemes: {
      bearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Cognito access token.',
      },
    },
  },
};
