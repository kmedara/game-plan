# EAS environment variables the store builds read (docs/store-release.md).
# Values come from Parameter Store under the same prefix the CDK app reads.
#
# The project id and account come from `app.json`, so they stay in one place.
# The provider reads `EXPO_TOKEN`. It cannot import, so a variable created by
# hand on expo.dev must be deleted there before the first apply.

locals {
  expo_app = jsondecode(file("${path.module}/../../client/expo/app.json")).expo

  maps_browser_key = lookup(local.parameters, "google-maps-browser-api-key", "")
  # Maps SDK for Android key, restricted to the package and signing certificate.
  maps_android_key = lookup(local.parameters, "google-maps-android-api-key", "")
  # `true` shows plan prices and the website link on iOS. Leave unset until
  # Apple allows it for the storefront.
  ios_web_upgrade = nonsensitive(lookup(local.parameters, "ios-web-upgrade", "false")) == "true"
  # Address the privacy page lists for privacy and support requests.
  support_email = nonsensitive(lookup(local.parameters, "support-email", ""))

  # Name to visibility. Kept apart from the values so `for_each` never sees a
  # sensitive value.
  eas_visibility = merge(
    {
      EXPO_PUBLIC_API_BASE_URL    = "PUBLIC"
      EXPO_PUBLIC_WS_BASE_URL     = "PUBLIC"
      EXPO_PUBLIC_IOS_WEB_UPGRADE = "PUBLIC"
    },
    # The browser key ships in the website anyway.
    nonsensitive(local.maps_browser_key != "") ? { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = "PUBLIC" } : {},
    nonsensitive(local.maps_android_key != "") ? { GOOGLE_MAPS_ANDROID_API_KEY = "SENSITIVE" } : {},
    local.support_email != "" ? { EXPO_PUBLIC_SUPPORT_EMAIL = "PUBLIC" } : {},
  )

  eas_values = {
    EXPO_PUBLIC_API_BASE_URL        = "https://${local.site_hostname}/api"
    EXPO_PUBLIC_WS_BASE_URL         = "wss://${local.site_hostname}/api/socket"
    EXPO_PUBLIC_IOS_WEB_UPGRADE     = tostring(local.ios_web_upgrade)
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = local.maps_browser_key
    GOOGLE_MAPS_ANDROID_API_KEY     = local.maps_android_key
    EXPO_PUBLIC_SUPPORT_EMAIL       = local.support_email
  }
}

provider "expo" {
  account_name = local.expo_app.owner
}

resource "expo_app_variable" "build" {
  for_each = local.eas_visibility

  app_id       = local.expo_app.extra.eas.projectId
  name         = each.key
  value        = local.eas_values[each.key]
  visibility   = each.value
  environments = [var.eas_environment]

  lifecycle {
    precondition {
      condition     = local.zone_name != ""
      error_message = "${local.ssm_prefix}/hosted-zone-name is not set, so the app's API URLs cannot be built."
    }
  }
}
