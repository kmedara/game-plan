/**
 * Amazon Cognito user pool with Managed login for email and social sign-in.
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { areaEntry, createFunction } from './functions';

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
  /** Optional Google / Apple / Facebook Managed login providers. */
  social?: AuthSocialContext;
  /**
   * When false, Managed login and the SignUp API reject new accounts.
   * Defaults to true.
   */
  selfSignUpEnabled?: boolean;
  /**
   * Parameter Store name of the staging email allowlist.
   * When set, a pre sign-up Lambda rejects every address that is not listed.
   */
  signupAllowlistParameter?: string;
};

/**
 * User pool, Managed login domain, and public OAuth app client.
 *
 * The Expo app does not talk to Cognito directly. Identity exchanges the
 * authorization code and issues GamePlan session tokens.
 */
export class Auth extends Construct {
  /** Cognito user pool that owns accounts. */
  public readonly userPool: cognito.UserPool;

  /** Public app client used by the Managed login OAuth flow. */
  public readonly userPoolClient: cognito.UserPoolClient;

  /** Cognito Managed login hostname (no scheme), including the `auth.<region>.amazoncognito.com` suffix. */
  public readonly hostedUiDomain: string;

  /**
   * Creates the user pool, optional social IdPs, Managed login domain, and outputs.
   *
   * @param scope - The parent CDK construct.
   * @param id - The construct id.
   * @param props - Callback URLs and optional social IdP credentials.
   */
  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'gameplan-users',
      selfSignUpEnabled: props.selfSignUpEnabled ?? true,
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
      // Accounts cannot be recreated (password hashes do not export), so a stack
      // delete or replacement leaves the pool in place.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
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

    const allowlistParameter = props.signupAllowlistParameter?.trim();
    if (allowlistParameter !== undefined && allowlistParameter.length > 0) {
      const preSignUp = createFunction(
        this,
        'pre-signup',
        areaEntry('identity', 'pre-signup.ts'),
        { ALLOWLIST_PARAMETER: allowlistParameter },
        5,
      );
      preSignUp.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['ssm:GetParameter'],
          resources: [
            cdk.Stack.of(this).formatArn({
              service: 'ssm',
              resource: 'parameter',
              resourceName: allowlistParameter.replace(/^\//u, ''),
              arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
            }),
          ],
        }),
      );
      this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUp);
    }

    const domainPrefix = `gameplan-${cdk.Aws.ACCOUNT_ID}`;
    const domain = this.userPool.addDomain('HostedUi', {
      cognitoDomain: { domainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    // `domainName` is only the prefix (`gameplan-<account>`). Managed login lives on the full hostname.
    this.hostedUiDomain = cdk.Fn.select(1, cdk.Fn.split('://', domain.baseUrl()));

    new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: this.userPool.userPoolId,
      clientId: this.userPoolClient.userPoolClientId,
      useCognitoProvidedValues: false,
      settings: managedLoginSettings(),
    });

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

/** Cognito colors are eight hex digits, `RRGGBBAA`, with no leading `#`. */
const cognitoColor = (hex: string): string => `${hex.slice(1)}ff`;

const buttonColors = (background: string, text: string): { backgroundColor: string; textColor: string } => ({
  backgroundColor: cognitoColor(background),
  textColor: cognitoColor(text),
});

/**
 * Managed login colors aligned with the Expo canvas and field green in `client/expo/src/theme.ts`.
 */
const managedLoginSettings = (): Record<string, unknown> => {
  const field = '#0a6e38';
  const fieldDeep = '#064e28';
  const canvas = '#eef2ef';
  const paper = '#ffffff';
  const ink = '#ffffff';
  return {
    categories: {
      global: { colorSchemeMode: 'LIGHT' },
    },
    components: {
      pageBackground: {
        image: { enabled: false },
        lightMode: { color: cognitoColor(canvas) },
      },
      form: {
        lightMode: { backgroundColor: cognitoColor(paper) },
        logo: { enabled: false },
      },
      primaryButton: {
        lightMode: {
          defaults: buttonColors(field, ink),
          hover: buttonColors(fieldDeep, ink),
          active: buttonColors(fieldDeep, ink),
        },
      },
    },
    componentClasses: {
      buttons: { borderRadius: 8 },
      focusState: {
        lightMode: { borderColor: cognitoColor(field) },
      },
    },
  };
};
