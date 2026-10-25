variable "deploy_env" {
  description = "Deploy environment, the same name as the GitHub environment and `DEPLOY_ENV`."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.deploy_env)
    error_message = "deploy_env must be staging or production."
  }
}

variable "aws_region" {
  description = "Region of Parameter Store."
  type        = string
  default     = "us-east-1"
}

variable "ssm_prefix" {
  description = "Parameter Store prefix the CDK app and functions read, `SSM_PREFIX` in CI."
  type        = string
  default     = "/gameplan"
}

variable "gcp_project_id" {
  description = "Google Cloud project that holds this environment's keys. Billing must be on."
  type        = string

  validation {
    condition     = var.gcp_project_id != ""
    error_message = "Set gcp_project_id in envs/<environment>.tfvars."
  }
}

variable "browser_extra_referrers" {
  description = "Referrers the browser key also accepts besides the website, such as a local dev server."
  type        = list(string)
  default     = []
}

variable "android_cert_sha1" {
  description = <<-EOT
    SHA-1 fingerprints of the Play app signing key and the upload key. The
    Android key is left out until at least one is set, so it is never unrestricted.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for print in var.android_cert_sha1 : can(regex("^([0-9A-Fa-f]{2}:){19}[0-9A-Fa-f]{2}$", print))])
    error_message = "Each fingerprint must be SHA-1 in AA:BB:... form (20 bytes), not SHA-256."
  }
}
