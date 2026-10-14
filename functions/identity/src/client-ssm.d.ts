/**
 * Types for the Parameter Store client shipped with the Lambda Node.js runtime.
 *
 * NodejsFunction leaves `@aws-sdk/*` external, so this package is not an application dependency.
 */

declare module '@aws-sdk/client-ssm' {
  /** Minimal GetParameter result used by the staging allowlist. */
  export type GetParameterResult = {
    Parameter?: { Value?: string };
  };

  /** Command for `GetParameter`. */
  export class GetParameterCommand {
    /**
     * @param input - The parameter name.
     */
    constructor(input: { Name: string });
  }

  /** Regional Systems Manager client. */
  export class SSMClient {
    /**
     * @param config - Unused. The runtime supplies region and credentials.
     */
    constructor(config?: Record<string, never>);

    /**
     * @param command - A GetParameter command.
     * @returns The parameter, when it exists.
     */
    send(command: GetParameterCommand): Promise<GetParameterResult>;
  }
}
