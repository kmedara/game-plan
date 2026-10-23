# Plans against mocked providers: no AWS, Stripe, or Expo calls.

mock_provider "aws" {
  override_data {
    target = data.aws_cloudformation_stack.api
    values = {
      outputs = {
        PaymentsWebhookUrl = "https://payments.lambda-url.us-east-1.on.aws/payments/webhook"
        BillingWebhookUrl  = "https://billing.lambda-url.us-east-1.on.aws/billing/webhook"
      }
    }
  }
  override_data {
    target = data.aws_ssm_parameters_by_path.deploy
    values = {
      names  = ["/gameplan/hosted-zone-name", "/gameplan/google-maps-browser-api-key"]
      values = ["example.com.", "browser-key"]
    }
  }
}

mock_provider "stripe" {}

mock_provider "expo" {}

variables {
  deploy_env      = "staging"
  eas_environment = "preview"
  stripe_api_key  = "sk_test_mock"
}

run "staging" {
  command = plan

  assert {
    condition     = local.eas_values.EXPO_PUBLIC_API_BASE_URL == "https://staging.example.com/api"
    error_message = "API URL should be the website host plus /api."
  }

  assert {
    condition     = local.eas_values.EXPO_PUBLIC_WS_BASE_URL == "wss://staging.example.com/api/socket"
    error_message = "Socket URL should be wss on the website host."
  }

  assert {
    condition     = local.eas_values.EXPO_PUBLIC_IOS_WEB_UPGRADE == "false"
    error_message = "The iOS upgrade link should be off when ios-web-upgrade is unset."
  }

  assert {
    condition = toset(keys(local.eas_visibility)) == toset([
      "EXPO_PUBLIC_API_BASE_URL",
      "EXPO_PUBLIC_WS_BASE_URL",
      "EXPO_PUBLIC_IOS_WEB_UPGRADE",
      "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
    ])
    error_message = "The Android Maps key should be left out when it is empty."
  }

  assert {
    condition     = stripe_webhook_endpoint.payments.connect && !coalesce(stripe_webhook_endpoint.billing.connect, false)
    error_message = "Only the payments endpoint listens to connected accounts."
  }

  assert {
    condition     = aws_ssm_parameter.payments_webhook_secret.name == "/gameplan/stripe-webhook-secret"
    error_message = "The payments function reads <prefix>/stripe-webhook-secret."
  }

  assert {
    condition     = aws_ssm_parameter.billing_webhook_secret.name == "/gameplan/stripe-billing-webhook-secret"
    error_message = "The billing webhook reads <prefix>/stripe-billing-webhook-secret."
  }
}

run "optional_parameters" {
  command = plan

  override_data {
    target = data.aws_ssm_parameters_by_path.deploy
    values = {
      names  = ["/gameplan/hosted-zone-name", "/gameplan/google-maps-android-api-key", "/gameplan/ios-web-upgrade"]
      values = ["example.com", "android-key", "true"]
    }
  }

  assert {
    condition     = local.eas_values.EXPO_PUBLIC_IOS_WEB_UPGRADE == "true"
    error_message = "ios-web-upgrade should reach EXPO_PUBLIC_IOS_WEB_UPGRADE."
  }

  assert {
    condition     = expo_app_variable.build["GOOGLE_MAPS_ANDROID_API_KEY"].visibility == "SENSITIVE"
    error_message = "The Android Maps key should be a sensitive EAS variable."
  }

  assert {
    condition     = expo_app_variable.build["EXPO_PUBLIC_API_BASE_URL"].app_id == "fa70eb6b-e8c0-44c7-b9c8-a6c731d14f11"
    error_message = "Variables should go to the project id in app.json."
  }

  assert {
    condition     = toset(expo_app_variable.build["EXPO_PUBLIC_API_BASE_URL"].environments) == toset(["preview"])
    error_message = "Staging variables belong to the EAS preview environment."
  }
}

run "production_rejects_test_key" {
  command = plan

  variables {
    deploy_env      = "production"
    eas_environment = "production"
    stripe_api_key  = "sk_test_mock"
  }

  expect_failures = [var.stripe_api_key]
}
