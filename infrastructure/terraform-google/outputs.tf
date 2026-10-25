output "key_parameters" {
  description = "Parameter Store names that hold a Maps key."
  value       = sort([for parameter in aws_ssm_parameter.maps_key : parameter.name])
}

output "browser_referrers" {
  description = "Referrers the browser key accepts."
  value       = google_apikeys_key.browser.restrictions[0].browser_key_restrictions[0].allowed_referrers
}
