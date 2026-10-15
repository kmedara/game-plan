/**
 * Structured error logs for area Lambdas.
 *
 * CloudWatch receives one JSON object per line: `area`, `route`, and `msg`.
 */

/** One error log line. */
export type ErrorLog = {
  /** Product area, such as `identity` or `teams`. */
  area: string;
  /** Route that failed, such as `GET /identity/oauth/callback`. */
  route: string;
  /** Short error message. */
  msg: string;
  /** The thrown value. */
  error: unknown;
};

/**
 * Reads the area stamped on the function.
 *
 * `AREA` is set when the function is created. Local runs fall back to the
 * Lambda name with the `gameplan-` prefix removed.
 *
 * @returns The area id, or `unknown`.
 */
export const functionArea = (): string => {
  const configured = process.env.AREA?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  const name = process.env.AWS_LAMBDA_FUNCTION_NAME ?? "";
  const prefix = "gameplan-";
  if (name.startsWith(prefix)) return name.slice(prefix.length);
  return name.length > 0 ? name : "unknown";
};

/**
 * Builds a route label from an HTTP API event.
 *
 * @param event - The request that failed.
 * @returns `METHOD /path`, or `unknown` when both are missing.
 */
export const httpRoute = (event: {
  rawPath?: string;
  requestContext?: { http?: { method?: string } };
}): string => {
  const method = event.requestContext?.http?.method ?? "";
  const path = event.rawPath ?? "";
  const route = `${method} ${path}`.trim();
  return route.length > 0 ? route : "unknown";
};

/**
 * Reads a short message from a thrown value.
 *
 * @param error - The caught value.
 * @returns The error message, or its string form.
 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Writes one structured error log line.
 *
 * @param entry - Area, route, and message.
 */
export const logError = (entry: ErrorLog): void => {
  console.error(
    JSON.stringify({
      area: entry.area,
      route: entry.route,
      msg: entry.msg,
      error: JSON.stringify(entry.error),
    }),
  );
};
