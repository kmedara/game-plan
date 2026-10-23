/**
 * Unit tests for CDK context and environment deploy settings.
 */

import { describe, expect, it } from 'vitest';
import {
  allowlistEmails,
  definedString,
  hostnameOf,
  mailDomainFor,
  mailRecordsFor,
  publicUrlsFor,
  siteApiBaseUrl,
  splitUrlList,
  urlListFromUnknown,
} from './deploy-config';

describe('deploy config', () => {
  it('drops blank strings', () => {
    expect(definedString('  ')).toBeUndefined();
    expect(definedString('https://app.example.com')).toBe('https://app.example.com');
    expect(definedString(1)).toBeUndefined();
  });

  it('splits comma-separated URLs', () => {
    expect(splitUrlList(' https://a.example/cb , https://b.example/cb ')).toEqual([
      'https://a.example/cb',
      'https://b.example/cb',
    ]);
    expect(splitUrlList(' , ')).toBeUndefined();
    expect(splitUrlList(undefined)).toBeUndefined();
  });

  it('builds the website hostname and /api callback from the environment and domain', () => {
    expect(publicUrlsFor('staging', 'Example.com.')).toEqual({
      clientOrigin: 'https://staging.example.com',
      callbackUrl: 'https://staging.example.com/api/identity/oauth/callback',
      logoutUrl: 'https://staging.example.com/login',
      siteHostname: 'staging.example.com',
    });
    expect(siteApiBaseUrl('https://staging.example.com')).toBe('https://staging.example.com/api');
    expect(() => publicUrlsFor('staging', 'localhost')).toThrow(/HOSTED_ZONE_NAME/);
  });

  it('reads a hostname from an absolute URL', () => {
    expect(hostnameOf('https://app.example.com/api/identity/oauth/callback')).toBe('app.example.com');
    expect(hostnameOf('  ')).toBeUndefined();
    expect(hostnameOf('not a url')).toBeUndefined();
  });

  it('reads a URL list from context as an array or a string', () => {
    expect(urlListFromUnknown(['https://a.example/', '  '])).toEqual(['https://a.example/']);
    expect(urlListFromUnknown('https://a.example/,https://b.example/')).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
    expect(urlListFromUnknown(undefined)).toBeUndefined();
  });
});

describe('mail DNS', () => {
  it('sends from the bare domain in production and the website host elsewhere', () => {
    expect(mailDomainFor('production', 'Example.com.', 'production.example.com')).toBe('example.com');
    expect(mailDomainFor('staging', 'example.com', 'staging.example.com')).toBe('staging.example.com');
  });

  it('builds MX, apex TXT, and DMARC records from the parameters that are set', () => {
    expect(
      mailRecordsFor('example.com.', {
        mx: '1 smtp.google.com',
        txt: 'v=spf1 include:_spf.google.com ~all\ngoogle-site-verification=abc',
        dmarc: 'v=DMARC1; p=none',
      }),
    ).toEqual([
      { name: 'example.com', type: 'MX', values: ['1 smtp.google.com'] },
      {
        name: 'example.com',
        type: 'TXT',
        values: ['v=spf1 include:_spf.google.com ~all', 'google-site-verification=abc'],
      },
      { name: '_dmarc.example.com', type: 'TXT', values: ['v=DMARC1; p=none'] },
    ]);
    expect(mailRecordsFor('example.com', { mx: '10 mx1.improvmx.com, 20  mx2.improvmx.com' })).toEqual([
      { name: 'example.com', type: 'MX', values: ['10 mx1.improvmx.com', '20 mx2.improvmx.com'] },
    ]);
    expect(mailRecordsFor('example.com', {})).toEqual([]);
  });

  it('adds the provider’s own records, relative to the domain', () => {
    expect(
      mailRecordsFor('example.com', {
        extra: 'google._domainkey TXT v=DKIM1; k=rsa; p=MIIB\nfm1._domainkey.example.com. CNAME fm1.example.com.dkim.fmhosted.com',
      }),
    ).toEqual([
      { name: 'google._domainkey.example.com', type: 'TXT', values: ['v=DKIM1; k=rsa; p=MIIB'] },
      { name: 'fm1._domainkey.example.com', type: 'CNAME', values: ['fm1.example.com.dkim.fmhosted.com'] },
    ]);
    expect(() => mailRecordsFor('example.com', { extra: '@ TXT v=spf1 -all' })).toThrow('MAIL_TXT');
    expect(() => mailRecordsFor('example.com', { extra: 'example.com TXT v=spf1 -all' })).toThrow('MAIL_TXT');
    expect(() => mailRecordsFor('example.com', { extra: 'just-a-name' })).toThrow('MAIL_RECORDS');
  });

  it('reads the staging allowlist the way the sign-up check does', () => {
    expect(allowlistEmails(' A@Example.com,b@example.com\n a@example.com  not-an-email ')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
    expect(allowlistEmails(undefined)).toEqual([]);
  });

  it('rejects an MX entry without a priority', () => {
    expect(() => mailRecordsFor('example.com', { mx: 'smtp.google.com' })).toThrow('MAIL_MX');
  });
});
