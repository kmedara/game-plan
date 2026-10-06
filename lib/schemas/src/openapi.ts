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
  teamInviteSchema,
  teamListSchema,
  teamSummarySchema,
  updatePositionsBodySchema,
  updateRolePermissionsBodySchema,
  updateTeamBodySchema,
} from './teams.js';
import {
  completeProfileBodySchema,
  errorBodySchema,
  loginBodySchema,
  refreshBodySchema,
  registerBodySchema,
  sessionTokensSchema,
  updateProfileBodySchema,
  userProfileSchema,
} from './auth.js';
import {
  createEventBodySchema,
  eventResponseSchema,
  rsvpBodySchema,
  rsvpResponseSchema,
  scheduleListSchema,
  scheduleWindowQuerySchema,
  updateEventBodySchema,
} from './schedule.js';
import {
  chatListSchema,
  chatMessageSchema,
  chatSummarySchema,
  createPrivateChatBodySchema,
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
        post: { summary: 'Create an account', body: registerBodySchema, response: sessionTokensSchema },
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
      '/identity/profile': {
        patch: {
          summary: 'Set or clear the profile photo',
          body: updateProfileBodySchema,
          response: userProfileSchema,
          secured: true,
        },
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
          query: z.object({ returnTo: z.string().optional() }),
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
      '/teams/{teamId}/members/{userId}': {
        patch: { summary: "Change a member's role", body: assignRoleBodySchema },
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
      },
      '/schedule/teams/{teamId}/rsvps': {
        put: { summary: 'Set an RSVP for one occurrence', body: rsvpBodySchema, response: rsvpResponseSchema },
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
        description: 'Cognito access token. Not needed locally while AUTH_DISABLED=true.',
      },
    },
  },
};
