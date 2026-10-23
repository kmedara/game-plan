terraform {
  # 1.10 for S3 native state locking (`use_lockfile`).
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    stripe = {
      source  = "lukasaron/stripe"
      version = "~> 3.4"
    }
    # Community provider with one maintainer and access to EXPO_TOKEN, so it is
    # pinned exactly; read the changes before raising it.
    expo = {
      source  = "elevenode/expo"
      version = "= 1.1.10"
    }
  }

  # Bucket, key, and region come from `envs/<environment>.s3.tfbackend` plus
  # `-backend-config="bucket=..."`. State holds the webhook signing secrets.
  backend "s3" {}
}
