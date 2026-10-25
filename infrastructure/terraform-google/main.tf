# Google Maps Platform keys for one GamePlan environment.
#
# Applied by hand, not by the deploy workflow: the keys rarely change, and the
# deploy loads them from Parameter Store before anything else runs. Each key is
# written to the parameter its consumer already reads.

provider "aws" {
  region = var.aws_region
}

provider "google" {
  project = var.gcp_project_id
}

data "aws_ssm_parameter" "hosted_zone_name" {
  name = "${local.ssm_prefix}/hosted-zone-name"
}

locals {
  ssm_prefix = trimsuffix(var.ssm_prefix, "/")

  # Same `<environment>.<zone>` host as `publicUrlsFor` in `lib/deploy-config.ts`.
  zone_name     = lower(trimsuffix(data.aws_ssm_parameter.hosted_zone_name.insecure_value, "."))
  site_hostname = "${var.deploy_env}.${local.zone_name}"

  android_package = jsondecode(file("${path.module}/../../client/expo/app.json")).expo.android.package

  # Key to the APIs it may call. Server: `functions/places/src/google-places.ts`.
  # Browser: `client/expo/src/map-picker.tsx`. Android: react-native-maps.
  key_apis = {
    server  = ["places.googleapis.com", "geocoding-backend.googleapis.com", "static-maps-backend.googleapis.com"]
    browser = ["maps-backend.googleapis.com"]
    android = ["maps-android-backend.googleapis.com"]
  }

  # Parameter suffix to key. Android only once its fingerprints are set. Kept
  # apart from the key strings so `for_each` never sees a sensitive value.
  key_parameters = merge(
    {
      "google-maps-api-key"         = "server"
      "google-maps-browser-api-key" = "browser"
    },
    length(var.android_cert_sha1) > 0 ? { "google-maps-android-api-key" = "android" } : {},
  )
}

# Turning an API off would break the other environment if they share a project.
resource "google_project_service" "maps" {
  for_each = toset(concat(["apikeys.googleapis.com"], flatten(values(local.key_apis))))

  service            = each.value
  disable_on_destroy = false
}

resource "google_apikeys_key" "server" {
  name         = "gameplan-${var.deploy_env}-server"
  display_name = "GamePlan ${var.deploy_env} places Lambda"

  # No application restriction: Lambda has no fixed IP.
  restrictions {
    dynamic "api_targets" {
      for_each = local.key_apis.server
      content {
        service = api_targets.value
      }
    }
  }

  depends_on = [google_project_service.maps]
}

resource "google_apikeys_key" "browser" {
  name         = "gameplan-${var.deploy_env}-browser"
  display_name = "GamePlan ${var.deploy_env} website map"

  restrictions {
    dynamic "api_targets" {
      for_each = local.key_apis.browser
      content {
        service = api_targets.value
      }
    }

    browser_key_restrictions {
      allowed_referrers = concat(["https://${local.site_hostname}/*"], var.browser_extra_referrers)
    }
  }

  depends_on = [google_project_service.maps]

  lifecycle {
    precondition {
      condition     = local.zone_name != ""
      error_message = "${local.ssm_prefix}/hosted-zone-name is empty, so the website referrer cannot be built."
    }
  }
}

resource "google_apikeys_key" "android" {
  count = length(var.android_cert_sha1) > 0 ? 1 : 0

  name         = "gameplan-${var.deploy_env}-android"
  display_name = "GamePlan ${var.deploy_env} Android map"

  restrictions {
    dynamic "api_targets" {
      for_each = local.key_apis.android
      content {
        service = api_targets.value
      }
    }

    android_key_restrictions {
      dynamic "allowed_applications" {
        for_each = var.android_cert_sha1
        content {
          package_name     = local.android_package
          sha1_fingerprint = allowed_applications.value
        }
      }
    }
  }

  depends_on = [google_project_service.maps]
}

# String, not SecureString: the deploy loader reads with decryption off.
# `overwrite` takes over a parameter set by hand.
resource "aws_ssm_parameter" "maps_key" {
  for_each = local.key_parameters

  name        = "${local.ssm_prefix}/${each.key}"
  description = "Google Maps ${each.value} key. Managed by infrastructure/terraform-google."
  type        = "String"
  value = {
    server  = google_apikeys_key.server.key_string
    browser = google_apikeys_key.browser.key_string
    android = one(google_apikeys_key.android[*].key_string)
  }[each.value]
  overwrite = true
}
