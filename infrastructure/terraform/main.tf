# Stripe and Expo (EAS) setup for one GamePlan environment.
#
# Runs after the CDK deploy: the webhook URLs are CDK stack outputs, and the
# website host comes from the same Parameter Store prefix the CDK app reads.

provider "aws" {
  region = var.aws_region
}

provider "stripe" {
  api_key = var.stripe_api_key
}

data "aws_cloudformation_stack" "api" {
  name = var.api_stack_name
}

data "aws_ssm_parameters_by_path" "deploy" {
  path = var.ssm_prefix
}

locals {
  ssm_prefix = trimsuffix(var.ssm_prefix, "/")

  # Parameter suffix to value, such as `hosted-zone-name`.
  parameters = {
    for index, name in data.aws_ssm_parameters_by_path.deploy.names :
    trimprefix(name, "${local.ssm_prefix}/") => data.aws_ssm_parameters_by_path.deploy.values[index]
  }

  # Same `<environment>.<zone>` host as `publicUrlsFor` in `lib/deploy-config.ts`.
  zone_name     = lower(trimsuffix(nonsensitive(lookup(local.parameters, "hosted-zone-name", "")), "."))
  site_hostname = "${var.deploy_env}.${local.zone_name}"
}
