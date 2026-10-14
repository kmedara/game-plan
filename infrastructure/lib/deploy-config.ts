/**
 * Resolves deploy settings from CDK context, then process environment.
 *
 * Context is the local override. GitHub Actions sets the environment from
 * Parameter Store before `cdk deploy`.
 */

/**
 * Returns a non-blank string, or `undefined`.
 *
 * @param value - A context or environment value.
 * @returns The string, when it has non-whitespace content.
 */
export const definedString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
 * Splits a comma-separated URL list.
 *
 * @param value - `CALLBACK_URLS` or `LOGOUT_URLS`.
 * @returns Trimmed URLs, or `undefined` when none are present.
 */
export const splitUrlList = (value: string | undefined): string[] | undefined => {
  if (value === undefined) return undefined;
  const urls = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return urls.length > 0 ? urls : undefined;
};

/**
 * Reads a URL list from CDK context (an array or a comma-separated string).
 *
 * @param value - The context value from `tryGetContext`.
 * @returns Trimmed URLs, or `undefined` when the context value is absent.
 */
export const urlListFromUnknown = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    const urls = value
      .map((item) => definedString(item))
      .filter((item): item is string => item !== undefined);
    return urls.length > 0 ? urls : undefined;
  }
  return splitUrlList(definedString(value));
};
