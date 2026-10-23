/**
 * mailto and sms links that carry a team's invite code.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/**
 * True when the text is a single email address.
 *
 * @param value - The address field.
 * @returns Whether it can be placed in a mailto link.
 */
export const isEmailAddress = (value: string): boolean => EMAIL.test(value.trim());

/**
 * Invite page for a code on the current site.
 *
 * @param origin - The site origin, without a trailing path.
 * @param code - The team's invite code.
 * @returns An absolute invite URL.
 */
export const invitePageUrl = (origin: string, code: string): string =>
  `${origin.replace(/\/$/u, '')}/invite/${encodeURIComponent(code)}`;

/**
 * Website origin an invite link should point at.
 *
 * The website uses its own origin. The phone apps have none, so they use the
 * API host: deploys serve the API at `/api` on the website host. A link to that
 * host opens the store app when it is installed, and the website when it is not.
 *
 * @param windowOrigin - `window.location.origin`, or an empty string off the web.
 * @param apiBaseUrl - The HTTP API base, such as `https://app.example.com/api`.
 * @returns The origin, or `undefined` when neither gives a website.
 */
export const inviteSiteOrigin = (windowOrigin: string, apiBaseUrl: string): string | undefined => {
  if (windowOrigin.length > 0) return windowOrigin;
  try {
    const url = new URL(apiBaseUrl);
    return url.pathname.replace(/\/+$/u, '') === '/api' ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Plain-text body for an email or text invite.
 *
 * @param parts - The translated intro, the code label, the code, and an optional link.
 * @returns Lines the mail or messages app should send.
 */
export const inviteMessageBody = (parts: {
  intro: string;
  codeLabel: string;
  code: string;
  url?: string;
}): string => {
  const lines = [parts.intro, `${parts.codeLabel}: ${parts.code}`];
  if (parts.url !== undefined && parts.url.length > 0) lines.push(parts.url);
  return lines.join('\n');
};

/**
 * mailto URL with a subject and body.
 *
 * @param email - The recipient.
 * @param subject - The message subject.
 * @param body - The message body.
 * @returns A mailto URL.
 */
export const mailtoInviteUrl = (email: string, subject: string, body: string): string =>
  `mailto:${email.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/**
 * sms URL. iPhone uses `&body`; other clients use `?body`.
 *
 * @param phone - The recipient in E.164.
 * @param body - The message body.
 * @param separator - `&` on iPhone, `?` elsewhere.
 * @returns An sms URL.
 */
export const smsInviteUrl = (phone: string, body: string, separator: '&' | '?'): string =>
  `sms:${phone}${separator}body=${encodeURIComponent(body)}`;

/**
 * Picks the sms body separator from a user agent.
 *
 * @param userAgent - The browser user agent, or an empty string off the web.
 * @returns `&` for iPhone, iPad, and iPod; `?` otherwise.
 */
export const smsBodySeparator = (userAgent: string): '&' | '?' =>
  /iPhone|iPad|iPod/u.test(userAgent) ? '&' : '?';
