/**
 * Universal links (iOS) and App Links (Android) for the store apps.
 *
 * The website host serves the API at `/api`, so the host the phone should
 * claim is read from the API base URL. Only invite pages open the app: the
 * rest of the site, and `/api` OAuth callbacks in particular, stay in the browser.
 */

const API_PREFIX = '/api';

/** Website paths the store apps open instead of the browser. */
const APP_LINK_PATHS = ['/invite/*'];

/**
 * Website host to claim for app links.
 *
 * @param apiBaseUrl - The HTTP API base, such as `https://app.example.com/api`.
 * @returns The hostname, or `undefined` when the API is not `/api` on an https host.
 */
const appLinkHost = (apiBaseUrl) => {
  if (apiBaseUrl === undefined || apiBaseUrl.trim() === '') return undefined;
  let url;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  if (url.pathname.replace(/\/+$/u, '') !== API_PREFIX) return undefined;
  return url.hostname;
};

/**
 * Body of `/.well-known/apple-app-site-association`.
 *
 * @param teamId - The Apple developer team id.
 * @param bundleId - The iOS bundle identifier.
 * @returns The association document.
 */
const appleAppSiteAssociation = (teamId, bundleId) => ({
  applinks: {
    details: [
      {
        appIDs: [`${teamId}.${bundleId}`],
        components: APP_LINK_PATHS.map((path) => ({ '/': path })),
      },
    ],
  },
});

/**
 * Body of `/.well-known/assetlinks.json`.
 *
 * @param packageName - The Android application id.
 * @param fingerprints - SHA-256 signing certificate fingerprints (Play app signing and upload keys).
 * @returns The statement list.
 */
const assetLinks = (packageName, fingerprints) => [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageName,
      sha256_cert_fingerprints: fingerprints,
    },
  },
];

/**
 * Splits a comma-separated fingerprint list.
 *
 * @param value - `ANDROID_CERT_SHA256`.
 * @returns Upper-case fingerprints, possibly empty.
 */
const fingerprintList = (value) =>
  (value ?? '')
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);

/**
 * Android intent filter that verifies the website host for invite pages.
 *
 * @param host - The website hostname.
 * @returns An `android.intentFilters` entry.
 */
const androidIntentFilter = (host) => ({
  action: 'VIEW',
  autoVerify: true,
  data: APP_LINK_PATHS.map((path) => ({
    scheme: 'https',
    host,
    pathPrefix: path.replace(/\/\*$/u, '/'),
  })),
  category: ['BROWSABLE', 'DEFAULT'],
});

module.exports = {
  APP_LINK_PATHS,
  androidIntentFilter,
  appLinkHost,
  appleAppSiteAssociation,
  assetLinks,
  fingerprintList,
};
