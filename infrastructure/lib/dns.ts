/**
 * Public DNS for the website.
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
  /**
   * Requests the website certificate. The alias-only stack sets this to false
   * so certificate issuance stays in the DNS stack.
   */
  certificates?: boolean;
  /** Suffix for the function name. The DNS and API stacks each need their own. */
  handlerId?: string;
};

/**
 * Requests the website certificate and publishes its alias record.
 */
export class ZoneDns extends Construct {
  /** Issued certificate ARN in `us-east-1` for CloudFront. Absent when certificates are skipped. */
  public readonly siteCertificateArn?: string;

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
        SiteRegion: 'us-east-1',
      },
    });
    this.siteCertificateArn = certificates.getAttString('SiteCertificateArn');
  }

  /**
   * Points the website hostname at its CloudFront distribution.
   *
   * @param targets - Website distribution.
   */
  addAliases(targets: { distribution: cloudfront.Distribution }): void {
    new cdk.CustomResource(this, 'Aliases', {
      serviceToken: this.provider.serviceToken,
      properties: {
        Mode: 'aliases',
        HostedZoneId: this.zone.hostedZoneId,
        RoleArn: this.zone.roleArn ?? '',
        SiteName: this.zone.siteHostname,
        SiteTarget: targets.distribution.distributionDomainName,
        SiteTargetZoneId: CloudFrontTarget.getHostedZoneId(targets.distribution),
      },
    });
  }
}
