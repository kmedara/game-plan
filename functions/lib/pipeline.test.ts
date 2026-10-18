/**
 * Pipeline order, validation short-circuit, and accumulated context.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { issueLocalTokens } from "./auth/index.js";
import { requireMembership, requirePermission, requireUser } from "./guards.js";
import { json } from "./http.js";
import {
  asStep,
  dispatch,
  route,
  withBodyValidation,
  withMappedErrors,
  withQueryValidation,
  type HttpResult,
} from "./pipeline.js";

/**
 * Builds a minimal HTTP API event.
 *
 * @param body - Optional JSON body.
 * @returns An HTTP API event.
 */
const httpEvent = (body?: unknown): APIGatewayProxyEventV2 =>
  ({
    version: "2.0",
    rawPath: "/",
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method: "POST", path: "/" } },
  }) as APIGatewayProxyEventV2;

describe("route pipeline", () => {
  it("logs caught errors as area, route, and msg", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const previous = process.env.AREA;
    process.env.AREA = "teams";
    const handle = route(
      withMappedErrors(() => undefined),
      async () => {
        throw new Error("boom");
      },
    );
    await handle({
      ...httpEvent(),
      rawPath: "/teams",
      requestContext: { http: { method: "GET", path: "/teams" } },
    } as APIGatewayProxyEventV2);
    expect(errorSpy).toHaveBeenCalledWith(
      JSON.stringify({
        area: "teams",
        route: "GET /teams",
        msg: "boom",
        error: JSON.stringify(new Error("boom")),
      }),
    );
    errorSpy.mockRestore();
    if (previous === undefined) delete process.env.AREA;
    else process.env.AREA = previous;
  });

  it("uses fallback and hooks when an error is not mapped", async () => {
    const onError = vi.fn();
    const onUnmapped = vi.fn();
    const fallback = vi.fn(() => json(503, { error: "fallback" }));
    const handle = route(
      withMappedErrors(() => undefined, { onError, onUnmapped, fallback }),
      async () => {
        throw new Error("nope");
      },
    );
    await expect(handle(httpEvent())).resolves.toEqual(json(503, { error: "fallback" }));
    expect(onError).toHaveBeenCalledOnce();
    expect(onUnmapped).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("returns 400 when query validation fails", async () => {
    const run = vi.fn(async () => json(200, { ok: true }));
    const handle = route(withQueryValidation(z.object({ q: z.string().min(1) })), run);
    const result = await handle({
      ...httpEvent(),
      queryStringParameters: {},
    });
    expect(result.statusCode).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("passes validated query parameters to the handler", async () => {
    const handle = route(
      withQueryValidation(z.object({ q: z.string() })),
      async (ctx) => json(200, { q: ctx.query.q }),
    );
    const result = await handle({
      ...httpEvent(),
      queryStringParameters: { q: 'teams' },
    });
    expect(JSON.parse(result.body ?? "")).toEqual({ q: "teams" });
  });

  it("maps a throw from a later step", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = route(
      withMappedErrors(() => json(418, { error: "mapped" })),
      async () => {
        throw new Error("nope");
      },
    );

    await expect(handle(httpEvent())).resolves.toEqual(
      json(418, { error: "mapped" }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      JSON.stringify({
        area: "unknown",
        route: "POST /",
        msg: "nope",
        error: JSON.stringify(new Error("nope")),
      }),
    );
    errorSpy.mockRestore();
  });

  it("returns 400 and does not call the handler when the body is invalid", async () => {
    const run = vi.fn(async () => json(200, { ok: true }));
    const handle = route(
      withBodyValidation(z.object({ name: z.string().min(1) })),
      run,
    );

    const result = await handle(httpEvent({}));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body ?? "")).toEqual({
      errors: [{ field: "name", message: expect.any(String) }],
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("treats a missing body as an empty object for optional schemas", async () => {
    const run = vi.fn(async () => json(200, { ok: true }));
    const handle = route(
      withBodyValidation(z.object({ note: z.string().optional() })),
      run,
    );
    const result = await handle({
      version: "2.0",
      rawPath: "/",
      headers: {},
      requestContext: { http: { method: "POST", path: "/" } },
    } as APIGatewayProxyEventV2);
    expect(result.statusCode).toBe(200);
    expect(run).toHaveBeenCalledOnce();
  });

  it("skips steps after one that returns a response", async () => {
    const stop = asStep<object, object>(async () =>
      json(204, { stopped: true }),
    );
    const skipped = vi.fn(
      asStep<object, object>(async (ctx, next) => next(ctx)),
    );
    const handle = route(stop, skipped, async () =>
      json(200, { reached: true }),
    );

    await expect(handle(httpEvent())).resolves.toEqual(
      json(204, { stopped: true }),
    );
    expect(skipped).not.toHaveBeenCalled();
  });

  describe("accumulated context", () => {
    it("passes path args, user, and body to the handler", async () => {
      process.env.LOCAL_JWT_SECRET = "pipeline-test-secret";
      const { accessToken } = issueLocalTokens("user-1", "user-1@example.com");
      const handle = route(
        "POST",
        "/teams/:teamId",
        withBodyValidation(z.object({ name: z.string() })),
        requireUser(),
        async (ctx) =>
          json(200, {
            teamId: ctx.teamId,
            userId: ctx.user.userId,
            name: ctx.body.name,
          }),
      );

      const result = await handle({
        ...httpEvent({ name: "Wildcats" }),
        rawPath: "/teams/team-1",
        headers: { authorization: `Bearer ${accessToken}` },
        requestContext: {
          http: { method: "POST", path: "/teams/team-1" },
        },
      } as unknown as APIGatewayProxyEventV2);
      expect(JSON.parse(result.body ?? "")).toEqual({
        teamId: "team-1",
        userId: "user-1",
        name: "Wildcats",
      });
    });
  });
});

const _typedPermission = route(
  "GET",
  "/teams/:teamId",
  requireUser(),
  requireMembership(),
  requirePermission("manage_events"),
  async (ctx): HttpResult =>
    json(200, { userId: ctx.user.userId, teamId: ctx.teamId, role: ctx.member.role }),
);

// @ts-expect-error permission requires teamId and member already on the context
route(requirePermission("manage_events"), async () => json(200, {}));

// @ts-expect-error permission requires membership loaded first
route("GET", "/teams/:teamId", requireUser(), requirePermission("manage_events"), async () =>
  json(200, {}),
);

route(
  "GET",
  "/teams/:teamId",
  async (ctx) =>
    json(200, {
      // @ts-expect-error memberUserId is not a parameter of this path
      id: ctx.memberUserId,
    }),
);

void _typedPermission;

const dispatchEvent = (method: string, rawPath?: string): APIGatewayProxyEventV2 =>
  ({
    version: "2.0",
    rawPath,
    headers: {},
    requestContext: { http: { method, path: rawPath ?? "" } },
  }) as APIGatewayProxyEventV2;

describe("dispatch", () => {
  const directory = route("GET", "/teams/directory", async () => json(200, { which: "directory" }));
  const team = route("GET", "/teams/:teamId", async (ctx) => json(200, { which: ctx.teamId }));
  const sameShape = route("GET", "/teams/:id", async () => json(200, { which: "second" }));
  const object = route("GET", "/media/local-objects/*objectKey", async (ctx) =>
    json(200, { key: ctx.objectKey }),
  );

  it("fills parameters from the path and prefers more literal segments", async () => {
    const result = await dispatch(
      [team, directory],
      dispatchEvent("GET", "/teams/directory"),
    );
    expect(JSON.parse(result.body ?? "")).toEqual({ which: "directory" });

    const member = await team(dispatchEvent("GET", "/teams/abc%20d"));
    expect(JSON.parse(member.body ?? "")).toEqual({ which: "abc d" });
  });

  it("keeps the earlier route when two patterns score the same", async () => {
    const result = await dispatch(
      [team, sameShape],
      dispatchEvent("GET", "/teams/abc"),
    );
    expect(JSON.parse(result.body ?? "")).toEqual({ which: "abc" });
  });

  it("captures the rest of a splat, including slashes", async () => {
    const result = await object(dispatchEvent("GET", "/media/local-objects/uploads/u/x%20y"));
    expect(JSON.parse(result.body ?? "")).toEqual({ key: "uploads/u/x y" });
  });

  it("matches a path with the area prefix left off", async () => {
    const result = await dispatch([team, directory], dispatchEvent("GET", "directory"));
    expect(JSON.parse(result.body ?? "")).toEqual({ which: "directory" });
  });

  it("returns 404 when nothing matches", async () => {
    await expect(dispatch([team], dispatchEvent("POST", "/teams/abc"))).resolves.toMatchObject({
      statusCode: 404,
    });
    await expect(dispatch([team], dispatchEvent("GET"))).resolves.toMatchObject({
      statusCode: 404,
    });
    const bare = route("GET", "/:teamId/members", async () => json(200, { which: "members" }));
    await expect(dispatch([bare], dispatchEvent("GET", "/only"))).resolves.toMatchObject({
      statusCode: 404,
    });
  });

  it("treats a missing path as the area root and keeps a bad escape", async () => {
    const list = route("GET", "/teams", async () => json(200, { which: "list" }));
    const listed = await dispatch([list, team], dispatchEvent("GET"));
    expect(JSON.parse(listed.body ?? "")).toEqual({ which: "list" });

    const escaped = await team(dispatchEvent("GET", "/teams/%"));
    expect(JSON.parse(escaped.body ?? "")).toEqual({ which: "%" });
  });

  it("rejects a splat that is not last and an empty segment", () => {
    expect(() => route("GET", "/files/*key/tail", async () => json(200, {}))).toThrow(
      /splat must be last/,
    );
    expect(() => route("GET", "/teams//:teamId", async () => json(200, {}))).toThrow(
      /empty segment/,
    );
  });
});
