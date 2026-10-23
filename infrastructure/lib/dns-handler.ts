/**
 * Issues the site and API certificates and writes their DNS records.
 *
 * Certificate validation CNAMEs and the alias records live in a hosted zone that
 * may belong to another account. When a role ARN is set, Route 53 calls assume
 * that role. Certificates stay in this account.
 */

import {
  ACMClient,
  DeleteCertificateCommand,
  DescribeCertificateCommand,
  ListCertificatesCommand,
  RequestCertificateCommand,
} from '@aws-sdk/client-acm';
import {
  ChangeResourceRecordSetsCommand,
  GetChangeCommand,
  Route53Client,
} from '@aws-sdk/client-route-53';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

/** One CNAME the `records` mode keeps in the zone. */
export type CnameRecord = { Name: string; Value: string };

/** Record types the `records` mode writes. */
export type RecordType = 'CNAME' | 'MX' | 'TXT';

/**
 * One record set the `records` mode keeps in the zone.
 *
 * MX values are `<priority> <host>`. TXT values are plain text; quoting and
 * the 255-character split Route 53 needs happen here.
 */
export type DnsRecord = { Name: string; Type: RecordType; Values: string[] };

/** Properties for the certificate, alias, and record custom resources. */
type DnsProperties = {
  Mode: 'certificates' | 'aliases' | 'records';
  /** For `records`: the CNAMEs to keep, such as SES DKIM records. */
  Cnames?: CnameRecord[];
  /** For `records`: other record sets to keep, such as the mail provider's MX and TXT. */
  Records?: DnsRecord[];
  HostedZoneId: string;
  RoleArn?: string;
  SiteDomain?: string;
  /** Earlier hostname whose certificate the cross-stack export must keep returning. */
  RetainedSiteDomain?: string;
  ApiDomain?: string;
  SiteRegion?: string;
  ApiRegion?: string;
  SiteName?: string;
  SiteTarget?: string;
  SiteTargetZoneId?: string;
  ApiName?: string;
  ApiTarget?: string;
  ApiTargetZoneId?: string;
};

/** CloudFormation custom-resource event from the CDK provider. */
type DnsEvent = {
  RequestType: 'Create' | 'Update' | 'Delete';
  PhysicalResourceId?: string;
  ResourceProperties: DnsProperties;
  OldResourceProperties?: DnsProperties;
};

/** Fields returned to CloudFormation. */
type DnsData = {
  /** Certificate the existing cross-stack export must keep returning. */
  SiteCertificateArn?: string;
  /** Certificate for the hostname in this request. */
  CurrentSiteCertificateArn?: string;
};

/**
 * Waits between Route 53 and certificate status checks.
 *
 * @param milliseconds - How long to wait.
 */
const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * Returns Route 53 credentials, assuming the zone role when one is configured.
 *
 * @param roleArn - Role in the account that owns the hosted zone.
 * @returns Credentials for the Route 53 client.
 */
const route53Credentials = async (
  roleArn: string | undefined,
): Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken: string } | undefined> => {
  if (roleArn === undefined || roleArn.trim() === '') return undefined;
  const assumed = await new STSClient({}).send(
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: 'gameplan-dns' }),
  );
  const credentials = assumed.Credentials;
  if (
    credentials?.AccessKeyId === undefined ||
    credentials.SecretAccessKey === undefined ||
    credentials.SessionToken === undefined
  ) {
    throw new Error('AssumeRole did not return credentials');
  }
  return {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken,
  };
};

/**
 * Builds a Route 53 client that can change the hosted zone.
 *
 * @param roleArn - Role in the account that owns the hosted zone.
 * @returns The Route 53 client.
 */
const route53Client = async (roleArn: string | undefined): Promise<Route53Client> =>
  new Route53Client({ region: 'us-east-1', credentials: await route53Credentials(roleArn) });

/**
 * Waits until a Route 53 change is applied.
 *
 * @param client - The Route 53 client.
 * @param changeId - The change id returned by `ChangeResourceRecordSets`.
 */
const waitForChange = async (client: Route53Client, changeId: string | undefined): Promise<void> => {
  if (changeId === undefined) return;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const change = await client.send(new GetChangeCommand({ Id: changeId }));
    if (change.ChangeInfo?.Status === 'INSYNC') return;
    await sleep(2000);
  }
  throw new Error(`Route 53 change ${changeId} did not finish`);
};

/**
 * Upserts or deletes one CNAME.
 *
 * @param client - The Route 53 client.
 * @param hostedZoneId - The zone that owns the name.
 * @param action - `UPSERT` or `DELETE`.
 * @param name - The record name.
 * @param value - The record value.
 */
const changeCname = async (
  client: Route53Client,
  hostedZoneId: string,
  action: 'UPSERT' | 'DELETE',
  name: string,
  value: string,
): Promise<void> => {
  const change = await client.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: action,
            ResourceRecordSet: {
              Name: name,
              Type: 'CNAME',
              TTL: 300,
              ResourceRecords: [{ Value: value }],
            },
          },
        ],
      },
    }),
  );
  await waitForChange(client, change.ChangeInfo?.Id);
};

/**
 * Upserts or deletes the A and AAAA aliases for one name.
 *
 * @param client - The Route 53 client.
 * @param hostedZoneId - The zone that owns the name.
 * @param action - `UPSERT` or `DELETE`.
 * @param name - The record name.
 * @param dnsName - The alias target.
 * @param targetZoneId - The hosted zone id of the alias target.
 */
const changeAlias = async (
  client: Route53Client,
  hostedZoneId: string,
  action: 'UPSERT' | 'DELETE',
  name: string,
  dnsName: string,
  targetZoneId: string,
): Promise<void> => {
  const target = dnsName.endsWith('.') ? dnsName : `${dnsName}.`;
  const change = await client.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: (['A', 'AAAA'] as const).map((type) => ({
          Action: action,
          ResourceRecordSet: {
            Name: name,
            Type: type,
            AliasTarget: {
              DNSName: target,
              HostedZoneId: targetZoneId,
              EvaluateTargetHealth: false,
            },
          },
        })),
      },
    }),
  );
  await waitForChange(client, change.ChangeInfo?.Id);
};

/**
 * Deletes an alias that a previous deploy left behind.
 *
 * A missing record is already gone. The website certificate is left in place
 * until CloudFront stops using it.
 *
 * @param client - The Route 53 client.
 * @param hostedZoneId - The zone that owns the name.
 * @param name - The previous record name.
 * @param dnsName - The alias target from the previous deploy.
 * @param targetZoneId - The hosted zone id of that alias target.
 */
const deleteAlias = async (
  client: Route53Client,
  hostedZoneId: string,
  name: string,
  dnsName: string,
  targetZoneId: string,
): Promise<void> => {
  try {
    await changeAlias(client, hostedZoneId, 'DELETE', name, dnsName, targetZoneId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('not found')) throw error;
  }
};

/**
 * Deletes a CNAME. A missing record is already gone.
 *
 * @param client - The Route 53 client.
 * @param hostedZoneId - The zone that owns the name.
 * @param record - The record as it was written.
 */
const deleteCname = async (client: Route53Client, hostedZoneId: string, record: CnameRecord): Promise<void> => {
  try {
    await changeCname(client, hostedZoneId, 'DELETE', record.Name, record.Value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('not found')) throw error;
  }
};

/**
 * Formats one TXT value for Route 53: quoted, with quotes and backslashes
 * escaped, and split into 255-character strings (SPF and DKIM can run longer).
 *
 * @param text - The plain value.
 * @returns The value as Route 53 stores it.
 */
export const txtRecordValue = (text: string): string => {
  const chunks = text.match(/[sS]{1,255}/gu) ?? [''];
  return chunks.map((chunk) => `"${chunk.replace(/["\]/gu, (char) => `\${char}`)}"`).join(' ');
};

/**
 * Every record set a `records` resource keeps, with its CNAMEs folded in.
 *
 * @param props - The resource properties.
 * @returns Record sets.
 */
export const recordsOf = (props: Pick<DnsProperties, 'Cnames' | 'Records'> | undefined): DnsRecord[] => [
  ...(props?.Cnames ?? []).map((record): DnsRecord => ({ Name: record.Name, Type: 'CNAME', Values: [record.Value] })),
  ...(props?.Records ?? []),
];

/**
 * Record sets a previous deploy wrote that the current one no longer has.
 *
 * @param previous - Record sets from the previous deploy.
 * @param current - Record sets now.
 * @returns The ones to delete. A name and type kept with new values is upserted instead.
 */
export const staleRecords = (previous: readonly DnsRecord[] | undefined, current: readonly DnsRecord[]): DnsRecord[] => {
  const key = (record: DnsRecord): string => `${record.Type} ${record.Name.toLowerCase().replace(/.$/u, '')}`;
  const kept = new Set(current.map(key));
  return (previous ?? []).filter((record) => !kept.has(key(record)));
};

/**
 * Upserts or deletes one record set.
 *
 * @param client - The Route 53 client.
 * @param hostedZoneId - The zone that owns the name.
 * @param action - `UPSERT` or `DELETE`.
 * @param record - The record set.
 */
const changeRecord = async (
  client: Route53Client,
  hostedZoneId: string,
  action: 'UPSERT' | 'DELETE',
  record: DnsRecord,
): Promise<void> => {
  const change = await client.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: action,
            ResourceRecordSet: {
              Name: record.Name,
              Type: record.Type,
              TTL: 300,
              ResourceRecords: record.Values.map((value) => ({
                Value: record.Type === 'TXT' ? txtRecordValue(value) : value,
              })),
            },
          },
        ],
      },
    }),
  );
  await waitForChange(client, change.ChangeInfo?.Id);
};

/**
 * Deletes a record set. A missing one is already gone.
 *
 * @param client - The Route 53 client.
 * @param hostedZoneId - The zone that owns the name.
 * @param record - The record set as it was written.
 */
const deleteRecord = async (client: Route53Client, hostedZoneId: string, record: DnsRecord): Promise<void> => {
  try {
    await changeRecord(client, hostedZoneId, 'DELETE', record);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('not found')) throw error;
  }
};

/**
 * Finds an existing certificate for a domain, preferring one that is already issued.
 *
 * @param client - The ACM client for the certificate region.
 * @param domain - The certificate domain name.
 * @returns The certificate ARN, or `undefined`.
 */
const findCertificate = async (client: ACMClient, domain: string): Promise<string | undefined> => {
  let nextToken: string | undefined;
  let pending: string | undefined;
  do {
    const page = await client.send(
      new ListCertificatesCommand({
        NextToken: nextToken,
        CertificateStatuses: ['ISSUED', 'PENDING_VALIDATION'],
      }),
    );
    for (const item of page.CertificateSummaryList ?? []) {
      if (item.DomainName !== domain || item.CertificateArn === undefined) continue;
      if (item.Status === 'ISSUED') return item.CertificateArn;
      pending ??= item.CertificateArn;
    }
    nextToken = page.NextToken;
  } while (nextToken !== undefined);
  return pending;
};

/**
 * Requests a certificate and publishes its validation CNAME.
 *
 * @param region - The certificate region.
 * @param domain - The certificate domain name.
 * @param route53 - The Route 53 client.
 * @param hostedZoneId - The zone that receives the validation record.
 * @returns The certificate ARN.
 */
const issueCertificate = async (
  region: string,
  domain: string,
  route53: Route53Client,
  hostedZoneId: string,
): Promise<string> => {
  const acm = new ACMClient({ region });
  const existing = await findCertificate(acm, domain);
  const arn =
    existing ??
    (
      await acm.send(
        new RequestCertificateCommand({
          DomainName: domain,
          ValidationMethod: 'DNS',
          IdempotencyToken: domain.replace(/[^0-9A-Za-z]/gu, '').slice(0, 32),
        }),
      )
    ).CertificateArn;
  if (arn === undefined) throw new Error(`Certificate request for ${domain} returned no ARN`);

  let published = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const described = await acm.send(new DescribeCertificateCommand({ CertificateArn: arn }));
    const status = described.Certificate?.Status;
    const record = described.Certificate?.DomainValidationOptions?.find(
      (option) => option.ResourceRecord?.Name !== undefined && option.ResourceRecord.Value !== undefined,
    )?.ResourceRecord;
    if (!published && record?.Name !== undefined && record.Value !== undefined) {
      await changeCname(route53, hostedZoneId, 'UPSERT', record.Name, record.Value);
      published = true;
    }
    if (status === 'ISSUED') return arn;
    if (status === 'FAILED' || status === 'REVOKED' || status === 'VALIDATION_TIMED_OUT') {
      throw new Error(`Certificate for ${domain} is ${status}`);
    }
    await sleep(10000);
  }
  throw new Error(`Certificate for ${domain} was not issued in time`);
};

/**
 * Deletes a domain's validation records and certificates.
 *
 * @param region - The certificate region.
 * @param domain - The certificate domain name.
 * @param route53 - The Route 53 client. When set, validation CNAMEs are removed first.
 * @param hostedZoneId - The zone that holds the validation records.
 */
const retireDomainCertificate = async (
  region: string,
  domain: string,
  route53?: Route53Client,
  hostedZoneId?: string,
): Promise<void> => {
  if (domain.trim() === '') return;
  const acm = new ACMClient({ region });
  let nextToken: string | undefined;
  do {
    const page = await clientPage(acm, nextToken);
    nextToken = page.nextToken;
    for (const item of page.arns.filter((entry) => entry.domain === domain)) {
      if (route53 !== undefined && hostedZoneId !== undefined) {
        const described = await acm.send(new DescribeCertificateCommand({ CertificateArn: item.arn }));
        for (const option of described.Certificate?.DomainValidationOptions ?? []) {
          const record = option.ResourceRecord;
          if (record?.Name === undefined || record.Value === undefined) continue;
          try {
            await changeCname(route53, hostedZoneId, 'DELETE', record.Name, record.Value);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('not found')) throw error;
          }
        }
      }
      await acm.send(new DeleteCertificateCommand({ CertificateArn: item.arn }));
    }
  } while (nextToken !== undefined);
};

/**
 * Lists certificate ARNs and domain names from one page.
 *
 * @param client - The ACM client.
 * @param nextToken - The pagination token.
 * @returns ARNs on this page and the next token.
 */
const clientPage = async (
  client: ACMClient,
  nextToken: string | undefined,
): Promise<{ arns: { arn: string; domain: string }[]; nextToken?: string }> => {
  const page = await client.send(
    new ListCertificatesCommand({
      NextToken: nextToken,
      CertificateStatuses: [
        'PENDING_VALIDATION',
        'ISSUED',
        'INACTIVE',
        'EXPIRED',
        'VALIDATION_TIMED_OUT',
        'REVOKED',
        'FAILED',
      ],
    }),
  );
  return {
    arns: (page.CertificateSummaryList ?? []).flatMap((item) =>
      item.CertificateArn !== undefined && item.DomainName !== undefined
        ? [{ arn: item.CertificateArn, domain: item.DomainName }]
        : [],
    ),
    nextToken: page.NextToken,
  };
};

/**
 * Chooses the hostname whose certificate the existing export must keep returning.
 *
 * A later update of the same hostname still pins the retained name. Otherwise
 * the export would change the next time this resource is updated.
 *
 * @param siteDomain - Hostname on this request.
 * @param retainedDomain - Hostname configured to stay on the export.
 * @param previousDomain - Hostname from the previous custom-resource properties.
 * @returns The pinned hostname, or `undefined` when the current certificate is safe to export.
 */
export const exportedCertificateDomain = (
  siteDomain: string,
  retainedDomain: string | undefined,
  previousDomain: string | undefined,
): string | undefined => {
  const retained = retainedDomain?.trim() ?? '';
  if (retained !== '' && retained !== siteDomain) return retained;
  const previous = previousDomain?.trim() ?? '';
  if (previous !== '' && previous !== siteDomain) return previous;
  return undefined;
};

/**
 * Handles certificate and alias custom resources.
 *
 * @param event - The CloudFormation custom-resource event.
 * @returns The physical id and certificate ARNs.
 */
export const handler = async (event: DnsEvent): Promise<{ PhysicalResourceId: string; Data?: DnsData }> => {
  const props = event.ResourceProperties;
  const route53 = await route53Client(props.RoleArn);
  const physicalResourceId =
    event.PhysicalResourceId ??
    `${props.Mode}:${props.SiteDomain ?? props.SiteName ?? recordsOf(props)[0]?.Name}`;

  if (props.Mode === 'records') {
    const records = recordsOf(props);
    if (event.RequestType === 'Delete') {
      for (const record of records) await deleteRecord(route53, props.HostedZoneId, record);
      return { PhysicalResourceId: physicalResourceId };
    }
    for (const record of records) await changeRecord(route53, props.HostedZoneId, 'UPSERT', record);
    if (event.RequestType === 'Update') {
      for (const record of staleRecords(recordsOf(event.OldResourceProperties), records)) {
        await deleteRecord(route53, props.HostedZoneId, record);
      }
    }
    return { PhysicalResourceId: physicalResourceId };
  }

  if (props.Mode === 'aliases') {
    const action = event.RequestType === 'Delete' ? 'DELETE' : 'UPSERT';
    if (props.SiteName && props.SiteTarget && props.SiteTargetZoneId) {
      await changeAlias(
        route53,
        props.HostedZoneId,
        action,
        props.SiteName,
        props.SiteTarget,
        props.SiteTargetZoneId,
      );
    }
    if (props.ApiName && props.ApiTarget && props.ApiTargetZoneId) {
      await changeAlias(
        route53,
        props.HostedZoneId,
        action,
        props.ApiName,
        props.ApiTarget,
        props.ApiTargetZoneId,
      );
    }
    if (event.RequestType === 'Update') {
      const previous = event.OldResourceProperties;
      const retained = new Set(
        [props.SiteName, props.ApiName].filter((name): name is string => name !== undefined),
      );
      const stale = [
        { name: previous?.ApiName, target: previous?.ApiTarget, zoneId: previous?.ApiTargetZoneId },
        { name: previous?.SiteName, target: previous?.SiteTarget, zoneId: previous?.SiteTargetZoneId },
      ];
      for (const record of stale) {
        if (record.name === undefined || record.target === undefined || record.zoneId === undefined) continue;
        if (retained.has(record.name)) continue;
        await deleteAlias(route53, props.HostedZoneId, record.name, record.target, record.zoneId);
      }
    }
    return { PhysicalResourceId: physicalResourceId };
  }

  const siteDomain = props.SiteDomain ?? '';
  const siteRegion = props.SiteRegion ?? 'us-east-1';
  if (event.RequestType === 'Delete') {
    await retireDomainCertificate(siteRegion, siteDomain, route53, props.HostedZoneId);
    return { PhysicalResourceId: physicalResourceId };
  }
  // GamePlanPlatform imports SiteCertificateArn. CloudFormation rejects the
  // stack update when that exported value changes, so keep returning the
  // certificate for the previous hostname until that import is gone.
  const currentCertificateArn = await issueCertificate(siteRegion, siteDomain, route53, props.HostedZoneId);
  const pinnedDomain = exportedCertificateDomain(
    siteDomain,
    props.RetainedSiteDomain,
    event.RequestType === 'Update' ? event.OldResourceProperties?.SiteDomain : undefined,
  );
  let siteCertificateArn = currentCertificateArn;
  if (pinnedDomain !== undefined) {
    const pinnedArn = await findCertificate(new ACMClient({ region: siteRegion }), pinnedDomain);
    if (pinnedArn !== undefined) siteCertificateArn = pinnedArn;
  }
  return {
    PhysicalResourceId: physicalResourceId,
    Data: {
      SiteCertificateArn: siteCertificateArn,
      CurrentSiteCertificateArn: currentCertificateArn,
    },
  };
};
