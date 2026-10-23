# Stripe Billing plans and the two webhook endpoints.
#
# The billing area finds prices by lookup key (`functions/billing/src/gateway.ts`),
# so these keys are the contract with the code. Amounts are in cents and must
# match the plan copy in `client/expo/src/en.json` and `es.json`.

locals {
  # Webhook events must match the switch in each area's `webhook.ts`.
  payments_webhook_events = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.expired",
    "checkout.session.async_payment_failed",
    "charge.refunded",
    "account.updated",
  ]
  billing_webhook_events = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]

  # The `stripe` package version in the functions pins this.
  stripe_api_version = "2026-08-26.dahlia"

  plan_products = {
    premium        = "GamePlan Premium"
    organization   = "GamePlan Organization"
    org_extra_team = "GamePlan Organization extra team"
  }

  # Lookup key to product and amount. Every item on a subscription renews on
  # the same interval, so the extra team has a yearly price too.
  plan_prices = {
    premium_monthly        = { product = "premium", interval = "month", unit_amount = 900 }
    premium_yearly         = { product = "premium", interval = "year", unit_amount = 9000 }
    org_monthly            = { product = "organization", interval = "month", unit_amount = 3500 }
    org_yearly             = { product = "organization", interval = "year", unit_amount = 35000 }
    org_extra_team_monthly = { product = "org_extra_team", interval = "month", unit_amount = 500 }
    org_extra_team_yearly  = { product = "org_extra_team", interval = "year", unit_amount = 5000 }
  }

  webhook_urls = data.aws_cloudformation_stack.api.outputs
}

resource "stripe_product" "plan" {
  for_each = local.plan_products

  name = each.value
}

resource "stripe_price" "plan" {
  for_each = local.plan_prices

  product     = stripe_product.plan[each.value.product].id
  currency    = "usd"
  unit_amount = each.value.unit_amount
  lookup_key  = each.key
  nickname    = each.key

  # A new amount is a new price. It takes the lookup key, so new checkouts use
  # it; existing subscriptions stay on the old price, which then has no lookup
  # key and is not recognised by the billing webhook until they are moved.
  transfer_lookup_key = true

  recurring {
    interval = each.value.interval
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Connect endpoint: dues checkouts and payouts on each team's connected account.
resource "stripe_webhook_endpoint" "payments" {
  url            = local.webhook_urls["PaymentsWebhookUrl"]
  description    = "GamePlan ${var.deploy_env} payments (Connect)"
  connect        = true
  api_version    = local.stripe_api_version
  enabled_events = local.payments_webhook_events
}

# Platform endpoint: team and organization subscriptions.
resource "stripe_webhook_endpoint" "billing" {
  url            = local.webhook_urls["BillingWebhookUrl"]
  description    = "GamePlan ${var.deploy_env} billing"
  api_version    = local.stripe_api_version
  enabled_events = local.billing_webhook_events
}

# The functions read the signing secrets from Parameter Store (ARCHITECTURE.md,
# "Secrets at run time"). `overwrite` takes over a parameter set by hand.
resource "aws_ssm_parameter" "payments_webhook_secret" {
  name        = "${local.ssm_prefix}/stripe-webhook-secret"
  description = "Signing secret of the Stripe Connect webhook (payments). Managed by Terraform."
  type        = "String"
  value       = stripe_webhook_endpoint.payments.secret
  overwrite   = true
}

resource "aws_ssm_parameter" "billing_webhook_secret" {
  name        = "${local.ssm_prefix}/stripe-billing-webhook-secret"
  description = "Signing secret of the Stripe Billing webhook. Managed by Terraform."
  type        = "String"
  value       = stripe_webhook_endpoint.billing.secret
  overwrite   = true
}
