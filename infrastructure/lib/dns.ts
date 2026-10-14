/**
 * Public DNS for the website and the HTTP API.
 *
 * The hosted zone may live in another account. The zone id and the role that
 * can change it are supplied at deploy time.
 */

import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { createFunction } from './functions';

/** Hosted zone the stack writes records into. */
export type DnsZoneProps = {
  /** Route 53 hosted zone id, such as `Z0123456789ABCDEFGHIJ`. */
  hostedZoneId: string;
  /** Role that can change the zone when it belongs to another account. */
  roleArn?: string;
  /** Website hostname, `app.<environment>.<domain>`. */
  siteHostname: string;
  /** HTTP API hostname from the first callback URL. */
  apiHostname: string;
  /**
   * Requests the site and API certificates. The alias-only stack sets this to false
   * so certificate issuance stays in the DNS stack.
   */
  certificates?: boolean;
  /** Suffix for the function name. The DNS and API stacks each need their own. */
  handlerId?: string;
};

/**
 * Requests certificates and publishes alias records for the site and the API.
 */
export class ZoneDns extends Construct {
  /** Issued certificate ARN in `us-east-1` for CloudFront. Absent when certificates are skipped. */
  public readonly siteCertificateArn?: string;

  /**
   * Issued certificate ARN for the HTTP API hostname.
   *
   * CloudFront requires this certificate in `us-east-1`. The DNS handler requests it in the stack
   * region, and the API edge refuses any other region.
   */
  public readonly apiCertificateArn?: string;

  private readonly provider: Provider;

  private readonly zone: DnsZoneProps;

  /**
   * Starts certificate requests. Alias records are added after the targets exist.
   *
   * @param scope - The parent construct.
   * @param id - The construct id.
   * @param props - The hosted zone and hostnames.
   */
  constructor(scope: Construct, id: string, props: DnsZoneProps) {
    super(scope, id);
    this.zone = props;
    const handler = createFunction(
      this,
      props.handlerId ?? 'dns',
      path.join(__dirname, 'dns-handler.ts'),
      {},
      900,
    );
    if (props.certificates !== false) {
      handler.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'acm:RequestCertificate',
            'acm:DescribeCertificate',
            'acm:DeleteCertificate',
            'acm:ListCertificates',
          ],
          resources: ['*'],
        }),
      );
    }
    if (props.roleArn === undefined) {
      handler.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['route53:ChangeResourceRecordSets', 'route53:GetChange'],
          resources: [
            `arn:${cdk.Stack.of(this).partition}:route53:::hostedzone/${props.hostedZoneId}`,
            `arn:${cdk.Stack.of(this).partition}:route53:::change/*`,
          ],
        }),
      );
    } else {
      handler.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: [props.roleArn],
        }),
      );
    }

    this.provider = new Provider(this, 'Provider', { onEventHandler: handler });
    if (props.certificates === false) return;

    const certificates = new cdk.CustomResource(this, 'Certificates', {
      serviceToken: this.provider.serviceToken,
      properties: {
        Mode: 'certificates',
        HostedZoneId: props.hostedZoneId,
        RoleArn: props.roleArn ?? '',
        SiteDomain: props.siteHostname,
        ApiDomain: props.apiHostname,
        SiteRegion: 'us-east-1',
        ApiRegion: cdk.Stack.of(this).region,
      },
    });
    this.siteCertificateArn = certificates.getAttString('SiteCertificateArn');
    this.apiCertificateArn = certificates.getAttString('ApiCertificateArn');
  }

  /**
   * Points the site and API hostnames at their CloudFront distributions.
   *
   * @param targets - Website distribution and the API distribution.
   */
  addAliases(targets: {
    distribution: cloudfront.Distribution;
    apiDistribution: cloudfront.Distribution;
  }): void {
    new cdk.CustomResource(this, 'Aliases', {
      serviceToken: this.provider.serviceToken,
      properties: {
        Mode: 'aliases',
        HostedZoneId: this.zone.hostedZoneId,
        RoleArn: this.zone.roleArn ?? '',
        SiteName: this.zone.siteHostname,
        SiteTarget: targets.distribution.distributionDomainName,
        SiteTargetZoneId: CloudFrontTarget.getHostedZoneId(targets.distribution),
        ApiName: this.zone.apiHostname,
        ApiTarget: targets.apiDistribution.distributionDomainName,
        ApiTargetZoneId: CloudFrontTarget.getHostedZoneId(targets.apiDistribution),
      },
    });
  }
}
