output "stripe_price_ids" {
  description = "Price id by lookup key."
  value       = { for key, price in stripe_price.plan : key => price.id }
}

output "stripe_payments_webhook_id" {
  description = "Connect webhook endpoint for dues and payouts."
  value       = stripe_webhook_endpoint.payments.id
}

output "stripe_billing_webhook_id" {
  description = "Platform webhook endpoint for subscriptions."
  value       = stripe_webhook_endpoint.billing.id
}

output "eas_variables" {
  description = "EAS variables set for this environment."
  value       = sort(keys(local.eas_visibility))
}
