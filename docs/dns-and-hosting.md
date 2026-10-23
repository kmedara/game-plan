# DNS and hosting

How each environment gets a hostname, TLS certificate, and a single CloudFront distribution for the Expo web export, the HTTP API, WebSockets, and (optionally) signed media. Stack ordering and product security headers are summarized here; session and WAF detail stays in [`ARCHITECTURE.md`](ARCHITECTURE.md#security).

| | Choice | Main cost |
| --- | --- | --- |
| Hostname | One site per environment: `<env>.<domain>` | Cache behaviors must split SPA vs `/api` |
| API path | Same origin, `/api/<area>` | No separate `api.` host or CORS preflight |
| TLS | ACM in `us-east-1`, custom-resource DNS | More code than built-in CDK; failed deploy can wait ~15 min |
| Static site | Private S3 + CloudFront OAC | Site bucket is `DESTROY` with stack; platform media is retained |

## URLs per environment

Given Parameter Store `<prefix>/hosted-zone-name` (for example `example.com`) and deploy environment `staging` or `production`:

| URL | Pattern |
| --- | --- |
| Website + API origin | `https://<environment>.<domain>` |
| HTTP API | `https://<environment>.<domain>/api/<area>/…` |
| WebSocket | `wss://<environment>.<domain>/api/socket?ticket=…` |
| OAuth callback | `https://<environment>.<domain>/api/identity/oauth/callback` |
| Logout redirect | `https://<environment>.<domain>/login` |

Logic: [`publicUrlsFor`](../infrastructure/lib/deploy-config.ts). Native apps call the same `/api` host as the website (not a separate API subdomain).

Production example: `https://production.example.com` if `DEPLOY_ENV=production` and zone `example.com`. Staging: `https://staging.example.com`.

**Why one host (not `api.`):** Same-origin JSON avoids CORS preflights on mobile networks. The refresh cookie is `SameSite=Lax` on path `/api/identity`. One certificate, one distribution, one WAF.

**Cost:** No distribution-wide custom error pages—they would turn API `403`/`404` into HTML. Extensionless website paths rewrite to `index.html` via a CloudFront Function instead.

## Four stacks and region

Deploy order (CloudFormation exports):

```text
GamePlanDns → GamePlanPlatform → GamePlanApi → GamePlanSite
```

Staging and production use the **same stack names** in **separate AWS accounts**. The site stack is last so it can attach Lambda function URLs and the WebSocket stage without the API stack importing the distribution (avoids a cycle).

**Region:** Website, CloudFront, WAF, and ACM for the distribution run in **`us-east-1`** (CloudFront certificate requirement). Lambda and DynamoDB follow the deploy region configured in CDK (`getStackEnv`).

See [`ARCHITECTURE.md` — Stacks and accounts](ARCHITECTURE.md#stacks-and-accounts) for why platform resources sit in an earlier stack.

## Parameter Store (DNS)

Under the deploy prefix (default `/gameplan`), as **String** parameters:

| Parameter | Becomes | Purpose |
| --- | --- | --- |
| `hosted-zone-id` | `HOSTED_ZONE_ID` | Route 53 zone for records |
| `hosted-zone-name` | `HOSTED_ZONE_NAME` | Apex domain; with `DEPLOY_ENV` derives the site hostname |

The deploy workflow loads these before `cdk deploy` ([`ssm-parameters.ts`](../infrastructure/lib/ssm-parameters.ts)). Without a hosted zone id, synth can still run for local templates, but **no** `GamePlanDns` stack, **no** alias to CloudFront, and **no** SES invite/Cognito mail DNS from the site stack.

### Cross-account hosted zone

The zone may live in another account. `DnsConfig` supports an optional `roleArn` on the DNS custom resource (`infrastructure/lib/dns.ts`, `dns-handler.ts`): the handler assumes that role for `route53:ChangeResourceRecordSets`. Certificates stay in the workload account. Wire `roleArn` when you extend `infrastructure/bin/app.ts` for your org (not set in the default CI path).

## Certificates

**GamePlanDns** requests an ACM certificate for the **website hostname** and writes **validation CNAMEs** in the hosted zone via a custom-resource Lambda (`infrastructure/lib/dns-handler.ts`).

**GamePlanSite** uses `currentCertificateArn` from the DNS stack (or `SITE_CERTIFICATE_ARN` for a manual override) on the CloudFront distribution.

- **Why a custom resource:** The zone may be cross-account. On hostname change, the handler can issue the new cert before CloudFront drops the old one. CDK’s built-in cert replacement can break a live distribution. The handler can keep exporting the **previous** certificate ARN so an importing stack is not blocked mid-migration (`RetainedSiteDomain` / `siteCertificateArn` export pattern).
- **Cost:** You own the Lambda and its IAM; a stuck custom resource blocks CloudFormation until timeout (~15 minutes).

CloudFront requires the certificate in **us-east-1**.

## What CloudFront serves

One distribution (`GamePlanSite` → `Website` in `infrastructure/lib/website.ts`):

| Path / behavior | Origin | Caching |
| --- | --- | --- |
| Default (static export) | S3 site bucket (OAC, private) | `CACHING_OPTIMIZED`; SPA rewrite for extensionless routes |
| `/api/<area>/*` | Lambda function URLs (OAC + SigV4) | Disabled |
| `/api/socket` | API Gateway WebSocket stage | N/A (upgrade) |
| `/api/csp-report` | Public CSP report Lambda URL | Disabled |
| `/uploads/*` (when media signing enabled) | S3 media bucket | Long TTL; signature stripped from cache key |

**Edge settings:** HTTP/2 and HTTP/3, compression on, `PRICE_CLASS_100` (North America and Europe edges). TLS minimum `TLS_V1_2_2021`; HTTP redirects to HTTPS.

**WAF:** Web ACL scoped to `/api/` (rate limits). Static assets are outside WAF rules. Pay-as-you-go WAF is used because CloudFront flat-rate plans cannot rate-limit on headers like `Authorization`. Rule table: [`ARCHITECTURE.md` — Rate limits](ARCHITECTURE.md#rate-limits).

**API access:** Function URLs use `AWS_IAM`. Only this distribution’s CloudFront service principal may invoke them (origin access control). Direct function URL calls fail; traffic is intended to pass WAF first.

**WebSocket:** CloudFront forwards the upgrade to API Gateway so connects use the site hostname and `SocketConnectIp` WAF rule. CloudFront adds `x-origin-verify` (Parameter Store `<prefix>/socket-origin-verify`); the `$connect` authorizer requires it. Details: [`realtime.md`](realtime.md).

**Stripe webhooks** and a few other callbacks use **separate public function URLs**, not this distribution—see [`stripe.md`](stripe.md).

## DNS records the deploy writes

| Record | Stack | When |
| --- | --- | --- |
| ACM validation CNAMEs | `GamePlanDns` | Certificate issue |
| Alias `A`/`AAAA` for `<environment>.<domain>` → CloudFront | `GamePlanSite` | After distribution exists |
| SES DKIM CNAMEs for mail domain | `GamePlanSite` | Invite (and Cognito) sending domain |
| MX / TXT / DMARC / provider DKIM on **bare domain** | `GamePlanSite` | Production only, from `mail-*` parameters |

**Mail domain** for sending: bare domain in production, website hostname elsewhere ([`mailDomainFor`](../infrastructure/lib/deploy-config.ts)). Inbound `support@` and provider DNS: [`email.md`](email.md).

## Site deploy (CI)

After `cdk deploy --all`, the workflow builds the Expo static export, **syncs** to the site bucket, and **invalidates** CloudFront `/*`.

**Open improvement** (from architecture notes): hashed assets should get long `Cache-Control`; `index.html` should be `no-cache`. Today invalidation clears the edge after each deploy.

## Operational gaps

- **First deploy socket gap:** `cdk deploy --all` updates API before site. For a few minutes the socket authorizer may require `x-origin-verify` while CloudFront is not yet sending it ([`ARCHITECTURE.md` — Gaps](ARCHITECTURE.md#gaps)).
- **Certificate export pin:** Changing the site hostname may require a staged deploy when another stack imports `SiteCertificateArn`.
- **Old native builds:** Clients still using `execute-api` for WebSockets miss live delivery until rebuilt against `wss://<site-host>/api/socket`.

## Local development

Local dev uses `http://localhost:4200` (and legacy `3000`) for OAuth callbacks in the Cognito app client—no CloudFront, OAC, WAF, or Route 53. Edge behavior is covered by CDK synth tests (`infrastructure/lib/*.test.ts`) and exercised in staging.

## Key files

| Path | Role |
| --- | --- |
| `infrastructure/bin/app.ts` | Stack wiring, URLs, DNS config |
| `infrastructure/lib/deploy-config.ts` | Hostname and mail domain helpers |
| `infrastructure/lib/gameplan-stack.ts` | Four stack classes |
| `infrastructure/lib/dns.ts` / `dns-handler.ts` | Certificates, aliases, mail records |
| `infrastructure/lib/website.ts` | S3 site bucket + distribution |
| `infrastructure/lib/site-api.ts` | `/api` behaviors, OAC, socket path |
| `infrastructure/lib/api-edge.ts` | WAF for `/api/` |
| `.github/workflows/deploy.yml` | Deploy, sync, invalidation |
