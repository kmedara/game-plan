/**
 * Amazon Simple Storage Service (S3) bucket for message media.
 */

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/** Inputs for the storage construct. */
export type StorageProps = {
  /** Browser origin allowed to upload and download message files. */
  corsOrigin: string;
};

/**
 * Message files stay private and are signed later. Dev stacks delete the bucket
 * with the stack.
 */
export class Storage extends Construct {
  /** Private bucket for message photos and files. */
  public readonly mediaBucket: s3.Bucket;

  /**
   * Creates the media bucket and its output.
   *
   * @param scope - The parent CDK construct.
   * @param id - The construct id.
   * @param props - CORS origin for the media bucket.
   */
  constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id);

    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.HEAD],
          allowedOrigins: [props.corsOrigin],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new cdk.CfnOutput(this, 'MediaBucketName', {
      value: this.mediaBucket.bucketName,
      exportName: 'GamePlanMediaBucketName',
    });
  }
}
