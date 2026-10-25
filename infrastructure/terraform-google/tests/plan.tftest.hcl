# Plans against mocked providers: no AWS or Google calls.

mock_provider "aws" {
  override_data {
    target = data.aws_ssm_parameter.hosted_zone_name
    values = {
      insecure_value = "Example.com."
    }
  }
}

mock_provider "google" {}

variables {
  deploy_env     = "staging"
  gcp_project_id = "gameplan-staging"
}

run "staging" {
  command = plan

  assert {
    condition     = google_apikeys_key.browser.restrictions[0].browser_key_restrictions[0].allowed_referrers == tolist(["https://staging.example.com/*"])
    error_message = "The browser key should accept only the website host."
  }

  assert {
    condition     = toset(google_apikeys_key.server.restrictions[0].api_targets[*].service) == toset(["places.googleapis.com", "geocoding-backend.googleapis.com", "static-maps-backend.googleapis.com"])
    error_message = "The server key should reach only the APIs the places Lambda calls."
  }

  assert {
    condition     = length(google_apikeys_key.android) == 0
    error_message = "No Android key without fingerprints, so it is never unrestricted."
  }

  assert {
    condition     = toset([for parameter in aws_ssm_parameter.maps_key : parameter.name]) == toset(["/gameplan/google-maps-api-key", "/gameplan/google-maps-browser-api-key"])
    error_message = "The keys should go to the parameters the places Lambda and the deploy read."
  }

  assert {
    condition     = alltrue([for parameter in aws_ssm_parameter.maps_key : parameter.type == "String"])
    error_message = "The deploy loader reads with decryption off, so the parameters must be String."
  }
}

run "android" {
  command = plan

  variables {
    android_cert_sha1       = ["DA:39:A3:EE:5E:6B:4B:0D:32:55:BF:EF:95:60:18:90:AF:D8:07:09"]
    browser_extra_referrers = ["http://localhost:8081/*"]
  }

  assert {
    condition     = google_apikeys_key.android[0].restrictions[0].android_key_restrictions[0].allowed_applications[0].package_name == "com.gameplan.app"
    error_message = "The Android key should be locked to the package in app.json."
  }

  assert {
    condition     = contains([for parameter in aws_ssm_parameter.maps_key : parameter.name], "/gameplan/google-maps-android-api-key")
    error_message = "The Android key should go to the parameter expo.tf reads."
  }

  assert {
    condition     = google_apikeys_key.browser.restrictions[0].browser_key_restrictions[0].allowed_referrers == tolist(["https://staging.example.com/*", "http://localhost:8081/*"])
    error_message = "Extra referrers should follow the website host."
  }
}

run "rejects_sha256" {
  command = plan

  variables {
    android_cert_sha1 = ["AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89"]
  }

  expect_failures = [var.android_cert_sha1]
}

run "requires_project" {
  command = plan

  variables {
    gcp_project_id = ""
  }

  expect_failures = [var.gcp_project_id]
}
