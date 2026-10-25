terraform {
  # 1.10 for S3 native state locking (`use_lockfile`).
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  # Same state bucket as `infrastructure/terraform`, under its own key. Bucket
  # comes from `-backend-config="bucket=..."`. State holds the three key strings.
  backend "s3" {}
}
