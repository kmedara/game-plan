/**
 * Core pipeline behavior with a non-HTTP context.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { asStep, catchErrors, issuePath, pipeline, validate } from "./index.js";

type Job = { payload: unknown; attempt: number };
type Outcome = { ok: boolean; detail: string };

const pipe = pipeline<Job, Outcome>();

const parsePayload = validate({
  key: "order",
  schema: z.object({ orderId: z.string(), items: z.array(z.string()).min(1) }),
  read: (ctx: Job) => ctx.payload,
  onInvalid: async (issues) => ({
    ok: false,
    detail: issues.map((issue) => `${issuePath(issue)}: invalid`).join(", "),
  }),
});

const stamp = asStep<{ order: { orderId: string } }, { traceId: string }, Outcome>(
  async (ctx, next) => next({ ...ctx, traceId: `trace-${ctx.order.orderId}` }),
);

describe("pipeline", () => {
  it("runs steps outer first and passes accumulated context", async () => {
    const order: string[] = [];
    const outer = asStep<object, object, Outcome>(async (ctx, next) => {
      order.push("outer:before");
      const result = await next(ctx);
      order.push("outer:after");
      return result;
    });

    const run = pipe(outer, parsePayload, stamp, async ({ order: o, traceId, attempt }) => {
      order.push("handler");
      return { ok: true, detail: `${traceId} ${o.items.length} ${attempt}` };
    });

    await expect(run({ payload: { orderId: "o1", items: ["a", "b"] }, attempt: 2 })).resolves.toEqual({
      ok: true,
      detail: "trace-o1 2 2",
    });
    expect(order).toEqual(["outer:before", "handler", "outer:after"]);
  });

  it("short-circuits with onInvalid and reports dotted paths", async () => {
    const run = pipe(parsePayload, async () => ({ ok: true, detail: "unreachable" }));
    await expect(run({ payload: { orderId: 1, items: [] }, attempt: 1 })).resolves.toEqual({
      ok: false,
      detail: "orderId: invalid, items: invalid",
    });
  });

  it("catchErrors turns throws from later steps into results", async () => {
    const run = pipe(
      catchErrors<Job, Outcome>((error, ctx) => ({
        ok: false,
        detail: `${(error as Error).message} on attempt ${ctx.attempt}`,
      })),
      async () => {
        throw new Error("boom");
      },
    );
    await expect(run({ payload: null, attempt: 3 })).resolves.toEqual({
      ok: false,
      detail: "boom on attempt 3",
    });
  });

  it("rejects steps whose requirements are not met yet", () => {
    // @ts-expect-error stamp needs `order`, which parsePayload has not attached
    pipe(stamp, parsePayload, async () => ({ ok: true, detail: "" }));
    // @ts-expect-error handler context is typed
    pipe(parsePayload, async (ctx) => ({ ok: true, detail: ctx.missing }));
  });

  it("issuePath handles object path segments", () => {
    expect(issuePath({ message: "x", path: ["a", { key: 0 }, "b"] })).toBe("a.0.b");
    expect(issuePath({ message: "x" })).toBe("");
  });
});
