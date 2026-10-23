variable "deploy_env" {
  description = "Deploy environment, the same name as the GitHub environment and `DEPLOY_ENV`."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.deploy_env)
    error_message = "deploy_env must be staging or production."
  }
}

variable "aws_region" {
  description = "Region of the CDK stacks and Parameter Store."
  type        = string
  default     = "us-east-1"
}

variable "ssm_prefix" {
  description = "Parameter Store prefix the CDK app and functions read, `SSM_PREFIX` in CI."
  type        = string
  default     = "/gameplan"
}

variable "api_stack_name" {
  description = "CloudFormation stack whose outputs hold the two webhook URLs."
  type        = string
  default     = "GamePlanApi"
}

variable "stripe_api_key" {
  description = "Stripe secret key that manages products, prices, and webhooks. Test mode for staging, live mode for production."
  type        = string
  sensitive   = true

  validation {
    condition = can(regex(
      var.deploy_env == "production" ? "^(sk|rk)_live_" : "^(sk|rk)_test_",
      var.stripe_api_key,
    ))
    error_message = "Use a live-mode Stripe key for production and a test-mode key for every other environment."
  }
}

variable "eas_environment" {
  description = "EAS environment the build profile reads: `preview` for staging, `production` for production."
  type        = string

  validation {
    condition     = contains(["development", "preview", "production"], var.eas_environment)
    error_message = "eas_environment must be development, preview, or production."
  }
}
