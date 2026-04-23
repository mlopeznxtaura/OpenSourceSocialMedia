#!/usr/bin/env bash
# colossus deploy -- one-command deploy
# Usage: ./deploy.sh [--cloud aws|gcp|azure|local] [--env staging|production]
set -euo pipefail

CLOUD=${CLOUD:-local}
ENV=${ENV:-staging}

while [[ $# -gt 0 ]]; do
  case $1 in
    --cloud) CLOUD=$2; shift 2 ;;
    --env)   ENV=$2;   shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "==> Colossus deploy: cloud=$CLOUD env=$ENV"

case $CLOUD in
  aws)
    cd infrastructure/terraform
    terraform init
    terraform apply -var="environment=$ENV" -auto-approve
    ;;
  local)
    docker-compose up --build -d
    echo "==> Running migrations..."
    sleep 5
    docker-compose exec postgres psql -U colossus -d colossus -f /migrations/001_init.sql 2>/dev/null || true
    echo "==> Colossus running on http://localhost:4000"
    ;;
  *)
    echo "Cloud '$CLOUD' not yet implemented. Use: aws, local"
    exit 1
    ;;
esac
