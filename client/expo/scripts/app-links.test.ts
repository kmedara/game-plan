/**
 * App link host and the website association files.
 */

import {
  androidIntentFilter,
  appLinkHost,
  appleAppSiteAssociation,
  assetLinks,
  fingerprintList,
} from './app-links';

describe('app links', () => {
  it('claims the website host only when it serves the API at /api over https', () => {
    expect(appLinkHost('https://staging.example.com/api')).toBe('staging.example.com');
    expect(appLinkHost('https://staging.example.com/api/')).toBe('staging.example.com');
    expect(appLinkHost('http://localhost:4200/api')).toBeUndefined();
    expect(appLinkHost('https://api.example.com')).toBeUndefined();
    expect(appLinkHost('not a url')).toBeUndefined();
    expect(appLinkHost(undefined)).toBeUndefined();
  });

  it('limits both platforms to invite pages', () => {
    expect(appleAppSiteAssociation('ABCDE12345', 'com.gameplan.app')).toEqual({
      applinks: {
        details: [{ appIDs: ['ABCDE12345.com.gameplan.app'], components: [{ '/': '/invite/*' }] }],
      },
    });
    expect(androidIntentFilter('app.example.com').data).toEqual([
      { scheme: 'https', host: 'app.example.com', pathPrefix: '/invite/' },
    ]);
  });

  it('lists every Android signing fingerprint', () => {
    const fingerprints = fingerprintList(' aa:bb , CC:DD,, ');
    expect(fingerprints).toEqual(['AA:BB', 'CC:DD']);
    expect(assetLinks('com.gameplan.app', fingerprints)[0]?.target.sha256_cert_fingerprints).toEqual(fingerprints);
    expect(fingerprintList(undefined)).toEqual([]);
  });
});
