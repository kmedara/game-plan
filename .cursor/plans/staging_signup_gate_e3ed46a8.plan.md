---
name: Staging signup gate
overview: Turn off Cognito self sign-up when deploying staging, and attach a pre sign-up Lambda that allows only emails listed in Parameter Store.
todos:
  - id: pool-flag
    content: Set selfSignUpEnabled false when DEPLOY_ENV is staging
    status: completed
  - id: pre-signup
    content: Add staging pre sign-up Lambda that reads the SSM allowlist and attach it to the pool
    status: completed
  - id: tests
    content: Unit-test allow and reject against a sample allowlist
    status: completed
isProject: false
---

# Staging signup gate

Staging is `DEPLOY_ENV=staging` in [infrastructure/bin/app.ts](infrastructure/bin/app.ts). That account’s pool is the only pool this deploy updates.

## Pool

In [infrastructure/lib/auth.ts](infrastructure/lib/auth.ts), pass `selfSignUpEnabled: deployEnv !== 'staging'` into `UserPool` (default stays `true` when `DEPLOY_ENV` is unset). Hosted UI Sign up and `SignUp` then stop working on staging. Existing users can still sign in.

## Pre sign-up Lambda

Add a small handler, for example [functions/identity/src/pre-signup.ts](functions/identity/src/pre-signup.ts), and attach it with `userPool.addTrigger(PRE_SIGN_UP, fn)` only when `DEPLOY_ENV` is `staging`.

On each invocation the function reads `/gameplan/staging-signup-allowlist` (`SSM_PREFIX` plus that suffix) and allows the Cognito `email` attribute only when it matches an entry. Compare case-insensitively. Split the parameter on commas and whitespace so either `a@x.com,b@x.com` or one address per line works. Throw when the email is missing or not listed, which Cognito surfaces as a failed sign-up. If Parameter Store has no parameter or the value is empty, reject everyone.

This runs for Hosted UI social first-login (`PreSignUp_ExternalProvider`) and for `AdminCreateUser` (`PreSignUp_AdminCreateUser`). A tester created in the console still has to be on the list. The Lambda’s role gets `ssm:GetParameter` on that parameter only. Do not add the list to `PARAMETER_ENV` in [infrastructure/lib/ssm-parameters.ts](infrastructure/lib/ssm-parameters.ts), so deploy does not copy the addresses into every function.

The parameter is not created by CDK, so later edits are not overwritten on deploy. Create it once in the staging account before relying on social sign-in:

`/gameplan/staging-signup-allowlist` = the tester emails.

## Tests

Unit-test the allowlist check with a sample string: matching address allowed, different casing allowed, unknown address rejected, blank list rejects.
