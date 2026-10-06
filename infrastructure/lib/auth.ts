/**
 * Amazon Cognito user pool with Hosted UI for email and social sign-in.
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/** Optional social Identity Provider (IdP) credentials from CDK context. */
export type AuthSocialContext = {
  googleClientId?: string;
  googleClientSecret?: string;
  facebookAppId?: string;
  facebookAppSecret?: string;
  appleClientId?: string;
  appleTeamId?: string;
  appleKeyId?: string;
  applePrivateKey?: string;
};

/** Props for {@link Auth}. */
export type AuthProps = {
  /** OAuth callback URLs registered on the app client (API callback routes). */
  callbackUrls: string[];
  /** OAuth logout URLs registered on the app client (website origins). */
  logoutUrls: string[];
  /** Optional Google / Apple / Facebook Hosted UI providers. */
  social?: AuthSocialContext;
};

/**
 * User pool, Hosted UI domain, and public OAuth app client.
 *
 * The Angular app does not talk to Cognito directly. Identity exchanges the
 * authorization code and issues GamePlan session tokens.
 */
export class Auth extends Construct {
  /** Cognito user pool that owns accounts. */
  public readonly userPool: cognito.UserPool;

  /** Public app client used by the Hosted UI OAuth flow. */
  public readonly userPoolClient: cognito.UserPoolClient;

  /** Cognito Hosted UI domain name (without scheme). */
  public readonly hostedUiDomain: string;

  /**
   * Creates the user pool, optional social IdPs, Hosted UI domain, and outputs.
   *
   * @param scope - The parent CDK construct.
   * @param id - The construct id.
   * @param props - Callback URLs and optional social IdP credentials.
   */
  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'gameplan-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const providers: cognito.UserPoolClientIdentityProvider[] = [
      cognito.UserPoolClientIdentityProvider.COGNITO,
    ];
    const idpConstructs: Construct[] = [];
    const social = props.social ?? {};

    if (social.googleClientId && social.googleClientSecret) {
      idpConstructs.push(
        new cognito.UserPoolIdentityProviderGoogle(this, 'Google', {
          userPool: this.userPool,
          clientId: social.googleClientId,
          clientSecretValue: cdk.SecretValue.unsafePlainText(social.googleClientSecret),
          scopes: ['openid', 'email', 'profile'],
          attributeMapping: {
            email: cognito.ProviderAttribute.GOOGLE_EMAIL,
            fullname: cognito.ProviderAttribute.GOOGLE_NAME,
          },
        }),
      );
      providers.push(cognito.UserPoolClientIdentityProvider.GOOGLE);
    }

    if (social.facebookAppId && social.facebookAppSecret) {
      idpConstructs.push(
        new cognito.UserPoolIdentityProviderFacebook(this, 'Facebook', {
          userPool: this.userPool,
          clientId: social.facebookAppId,
          clientSecret: social.facebookAppSecret,
          scopes: ['public_profile', 'email'],
          attributeMapping: {
            email: cognito.ProviderAttribute.FACEBOOK_EMAIL,
            fullname: cognito.ProviderAttribute.FACEBOOK_NAME,
          },
        }),
      );
      providers.push(cognito.UserPoolClientIdentityProvider.FACEBOOK);
    }

    if (
      social.appleClientId &&
      social.appleTeamId &&
      social.appleKeyId &&
      social.applePrivateKey
    ) {
      idpConstructs.push(
        new cognito.UserPoolIdentityProviderApple(this, 'Apple', {
          userPool: this.userPool,
          clientId: social.appleClientId,
          teamId: social.appleTeamId,
          keyId: social.appleKeyId,
          privateKey: social.applePrivateKey,
          scopes: ['email', 'name'],
          attributeMapping: {
            email: cognito.ProviderAttribute.APPLE_EMAIL,
            fullname: cognito.ProviderAttribute.APPLE_NAME,
          },
        }),
      );
      providers.push(cognito.UserPoolClientIdentityProvider.APPLE);
    }

    this.userPoolClient = this.userPool.addClient('AppClient', {
      userPoolClientName: 'gameplan-app',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: props.callbackUrls,
        logoutUrls: props.logoutUrls,
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
      supportedIdentityProviders: providers,
    });

    for (const idp of idpConstructs) {
      this.userPoolClient.node.addDependency(idp);
    }

    const domainPrefix = `gameplan-${cdk.Aws.ACCOUNT_ID}`;
    const domain = this.userPool.addDomain('HostedUi', {
      cognitoDomain: { domainPrefix },
    });
    this.hostedUiDomain = domain.domainName;

    const issuer = `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${this.userPool.userPoolId}`;

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: 'GamePlanUserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: 'GamePlanUserPoolClientId',
    });

    new cdk.CfnOutput(this, 'CognitoIssuer', {
      value: issuer,
      exportName: 'GamePlanCognitoIssuer',
    });

    new cdk.CfnOutput(this, 'CognitoRegion', {
      value: cdk.Stack.of(this).region,
      exportName: 'GamePlanCognitoRegion',
    });

    new cdk.CfnOutput(this, 'HostedUiDomain', {
      value: this.hostedUiDomain,
      exportName: 'GamePlanHostedUiDomain',
    });
  }
}
