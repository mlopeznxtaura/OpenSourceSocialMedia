# Colossus Social Kernel – Terraform (AWS EKS)
# terraform init && terraform apply -var-file=terraform.tfvars

terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws        = { source = "hashicorp/aws",        version = "~> 5.0" }
    kubernetes = { source = "hashicorp/kubernetes",  version = "~> 2.27" }
    helm       = { source = "hashicorp/helm",        version = "~> 2.13" }
    random     = { source = "hashicorp/random",      version = "~> 3.6" }
  }
  backend "s3" {
    bucket = "colossus-tfstate"
    key    = "colossus/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# ── VPC ───────────────────────────────────────────────────────────────────────
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"
  name    = "colossus-vpc"
  cidr    = "10.0.0.0/16"
  azs             = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
  enable_nat_gateway = true
  single_nat_gateway = var.environment != "production"
  tags = local.common_tags
}

# ── EKS ──────────────────────────────────────────────────────────────────────
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"
  cluster_name    = "colossus-${var.environment}"
  cluster_version = "1.29"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnets
  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    system = {
      instance_types = ["t3.medium"]
      min_size       = 2
      max_size       = 5
      desired_size   = 2
      labels         = { role = "system" }
    }
    kernels = {
      instance_types = ["c5.xlarge"]
      min_size       = 2
      max_size       = 50   # auto-scales as mini-kernels spawn
      desired_size   = 3
      labels         = { role = "mini-kernel" }
      taints         = [{ key = "mini-kernel", value = "true", effect = "NO_SCHEDULE" }]
    }
  }
  tags = local.common_tags
}

# ── RDS (PostgreSQL) ─────────────────────────────────────────────────────────
resource "aws_db_instance" "colossus" {
  identifier        = "colossus-${var.environment}"
  engine            = "postgres"
  engine_version    = "16.2"
  instance_class    = var.db_instance_class
  allocated_storage = 50
  db_name           = "colossus"
  username          = "colossus"
  password          = random_password.db.result
  db_subnet_group_name   = aws_db_subnet_group.colossus.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  skip_final_snapshot    = var.environment != "production"
  multi_az               = var.environment == "production"
  backup_retention_period = 7
  storage_encrypted  = true
  tags = local.common_tags
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "colossus" {
  name       = "colossus-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "rds" {
  name   = "colossus-rds-${var.environment}"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
}

# ── ElastiCache (Redis) ───────────────────────────────────────────────────────
resource "aws_elasticache_cluster" "colossus" {
  cluster_id      = "colossus-${var.environment}"
  engine          = "redis"
  node_type       = "cache.t3.micro"
  num_cache_nodes = 1
  subnet_group_name = aws_elasticache_subnet_group.colossus.name
}

resource "aws_elasticache_subnet_group" "colossus" {
  name       = "colossus-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

# ── Helm Deploy ───────────────────────────────────────────────────────────────
provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
    }
  }
}

resource "helm_release" "colossus" {
  name             = "colossus"
  chart            = "${path.module}/../helm/colossus"
  namespace        = "colossus"
  create_namespace = true
  values = [
    yamlencode({
      postgresql = { auth = { password = random_password.db.result } }
      global     = { namespace = "colossus" }
    })
  ]
  depends_on = [module.eks]
}

locals {
  common_tags = {
    Project     = "colossus"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
