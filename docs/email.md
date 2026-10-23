# Email for the domain

GamePlan sends its own email through Amazon SES: team invites, and Cognito's verification and password-reset email once it is switched over. People write to you at an address hosted by a mail provider. The CDK deploy keeps the DNS records for both in the hosted zone.

| What | From | Where it is set up |
| --- | --- | --- |
| Invites | `invites@<mail domain>` | SES identity in `GamePlanSite`, DKIM records written by the deploy |
| Cognito account email | `GamePlan <no-reply@<mail domain>>` | `GamePlanPlatform`, when `cognito-ses-email` is `true` |
| `support@` and other inboxes | Your mail provider | MX, TXT, and DKIM records from Parameter Store, production only |

The **mail domain** is the bare domain (`example.com`) in production and the website host (`staging.example.com`) elsewhere, so staging mail never looks like production's ([`mailDomainFor`](../infrastructure/lib/deploy-config.ts)). SES signs with DKIM for that domain, so mail passes DMARC without a custom MAIL FROM, and the domain's SPF record does not need to mention SES.

## Parameters

All under the deploy prefix (`/gameplan` by default), as **String** parameters.

| Parameter | Value |
| --- | --- |
| `cognito-ses-email` | `true` sends Cognito's email through SES. Leave it unset until both steps under [Turning on Cognito email](#turning-on-cognito-email) are done. |
| `mail-mx` | The provider's MX entries, `<priority> <host>`, separated by commas or new lines. |
| `mail-txt` | TXT values for the bare domain, one per line: the provider's SPF, and any domain-verification value. |
| `mail-dmarc` | The DMARC policy, such as `v=DMARC1; p=none; rua=mailto:dmarc@example.com`. Start with `p=none`, read the reports, then tighten. |
| `mail-records` | Anything else the provider asks for, such as its DKIM key: one `<name> <TXT\|CNAME> <value>` per line. `google._domainkey` means `google._domainkey.<domain>`, and `@` is the bare domain. |
| `support-email` | The address the privacy page lists (see [store-release.md](store-release.md)). |

The `mail-*` records are written only by the **production** deploy, because only production owns the bare domain. Each one **replaces** whatever record set the zone already has for that name and type, and is removed when you clear the parameter. If the zone already has MX or TXT records at the bare domain that you created by hand, copy every value you want to keep into the parameters before the next production deploy. A bad MX or `mail-records` line fails the deploy at synth, before anything changes.

## Providers

Copy the exact values from your provider's setup page; these show the shape.

**Google Workspace**

```text
mail-mx       1 smtp.google.com
mail-txt      v=spf1 include:_spf.google.com ~all
              google-site-verification=<from the Admin console>
mail-records  google._domainkey TXT v=DKIM1; k=rsa; p=<from Admin console → Gmail → Authenticate email>
```

**Fastmail**

```text
mail-mx       10 in1-smtp.messagingengine.com, 20 in2-smtp.messagingengine.com
mail-txt      v=spf1 include:spf.messagingengine.com ?all
mail-records  fm1._domainkey CNAME fm1.<domain>.dkim.fmhosted.com
              fm2._domainkey CNAME fm2.<domain>.dkim.fmhosted.com
              fm3._domainkey CNAME fm3.<domain>.dkim.fmhosted.com
```

**ImprovMX** (forwards to an inbox you already have)

```text
mail-mx       10 mx1.improvmx.com, 20 mx2.improvmx.com
mail-txt      v=spf1 include:spf.improvmx.com ~all
```

Cloudflare Email Routing needs the zone on Cloudflare's DNS, so it does not work with this Route 53 zone.

## Staging and the SES sandbox

Staging normally stays in the SES sandbox, where mail reaches only verified addresses. The staging deploy verifies every address on `<prefix>/staging-signup-allowlist` as an SES identity, so the people allowed to sign up can also receive invites. SES emails each new address a verification link; mail reaches them once they click it. Removing an address from the allowlist removes its identity on the next deploy. Production never does this.

## Turning on Cognito email

Cognito's own sender allows about 50 messages a day, which a real sign-up day can pass. To switch:

1. **Wait for the identity to verify.** After the first deploy with the hosted zone, SES → Identities shows the mail domain as *Verified* once the DKIM records resolve, usually within an hour.
2. **Leave the SES sandbox.** In the sandbox SES delivers only to addresses you have verified, so new sign-ups would never get their code. Request production access in the SES console (Account dashboard → Request production access) for the deploy region, once per AWS account. Describe the mail as account verification, password resets, and team invites people asked for.
3. Set `cognito-ses-email` to `true` and deploy. The user pool updates in place; accounts are not affected. Cognito creates its own service-linked role to send through SES.

Try it on staging first: sign up with a fresh address and confirm the code arrives from `no-reply@staging.<domain>`.

To switch back, delete the parameter and deploy.
