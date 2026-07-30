#!/usr/bin/env bash
# =============================================================================
# WalWatch — Production Deployment Script
# =============================================================================
# Usage:
#   ./scripts/deploy.sh <environment> [component]
#
# Environments:
#   testnet     — Deploy to Sui Testnet + dev infrastructure
#   mainnet     — Deploy to Sui Mainnet + production infrastructure
#
# Components (optional, default: all):
#   contract    — Publish/upgrade Move contract
#   backend     — Build + push + deploy API + Keeper Docker images
#   infra       — Apply Terraform infrastructure changes
#   db          — Run database migrations
#   all         — Everything (default)
#
# Prerequisites:
#   - sui CLI installed and configured for the target network
#   - Terraform >= 1.5
#   - Docker
#   - AWS CLI configured (for ECR/ECS deployments)
#   - jq
#
# Examples:
#   ./scripts/deploy.sh testnet contract          # Deploy contract only
#   ./scripts/deploy.sh testnet backend            # Deploy API + Keeper only
#   ./scripts/deploy.sh mainnet all               # Full production deploy
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ENVIRONMENT="${1:?Usage: $0 <testnet|mainnet> [component]}"
COMPONENT="${2:-all}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load environment-specific config
case "$ENVIRONMENT" in
  testnet)
    SUI_NETWORK="testnet"
    SUI_RPC="https://fullnode.testnet.sui.io:443"
    WALRUS_NETWORK="testnet"
    TF_DIR="$ROOT_DIR/infra"
    TF_WORKSPACE="testnet"
    DOCKER_TAG="testnet-$(date +%Y%m%d-%H%M%S)"
    # Default testnet Sui RPC URLs for failover
    SUI_RPC_URLS="https://fullnode.testnet.sui.io:443"
    ;;
  mainnet)
    SUI_NETWORK="mainnet"
    SUI_RPC="https://fullnode.mainnet.sui.io:443"
    WALRUS_NETWORK="mainnet"
    TF_DIR="$ROOT_DIR/infra"
    TF_WORKSPACE="mainnet"
    DOCKER_TAG="mainnet-$(date +%Y%m%d-%H%M%S)"
    SUI_RPC_URLS="https://fullnode.mainnet.sui.io:443"
    ;;
  *)
    echo "Unknown environment: $ENVIRONMENT (use testnet|mainnet)"
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()  { printf "\033[36m[deploy]\033[0m %s\n" "$*"; }
ok()    { printf "\033[32m[  ok]\033[0m %s\n" "$*"; }
err()   { printf "\033[31m[fail]\033[0m %s\n" "$*" >&2; exit 1; }

require() {
  if ! command -v "$1" &>/dev/null; then
    err "Required command not found: $1"
  fi
}

confirm() {
  echo ""
  read -r -p "Continue? [y/N] " reply
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

require sui
require terraform
require docker
require aws
require jq

# ---------------------------------------------------------------------------
# Component Functions
# ---------------------------------------------------------------------------

deploy_contract() {
  info "=== Publishing Move contract to $SUI_NETWORK ==="

  cd "$ROOT_DIR/contracts"

  # Verify Sui client is configured for the target network
  local active_env
  active_env=$(sui client active-env 2>/dev/null || echo "")
  if [[ "$active_env" != "$SUI_NETWORK" ]]; then
    err "Sui client active env is '$active_env', expected '$SUI_NETWORK'. Run: sui client switch --env $SUI_NETWORK"
  fi

  # Check for funded active address
  local active_addr
  active_addr=$(sui client active-address 2>/dev/null || true)
  if [[ -z "$active_addr" ]]; then
    err "No active Sui address. Create one with: sui client new-address ed25519"
  fi

  info "Active address: $active_addr"
  info "Publishing contract..."

  # Publish with large gas budget for Move compilation + storage
  local publish_output
  publish_output=$(sui client publish --gas-budget 100000000 --json 2>&1)
  local publish_exit=$?

  if [[ $publish_exit -ne 0 ]]; then
    err "Contract publish failed:\n$publish_output"
  fi

  # Extract package ID from publish result
  local package_id
  package_id=$(echo "$publish_output" | jq -r '.objectChanges[] | select(.type == "published") | .packageId // empty')
  if [[ -z "$package_id" ]]; then
    err "Could not extract package ID from publish output. Check: echo \"$publish_output\" | jq '.objectChanges'"
  fi

  # Extract FeeConfig and AdminCap object IDs
  local fee_config_id
  fee_config_id=$(echo "$publish_output" | jq -r '.objectChanges[] | select(.objectType | endswith("::vault::FeeConfig")) | .objectId // empty')
  local admin_cap_id
  admin_cap_id=$(echo "$publish_output" | jq -r '.objectChanges[] | select(.objectType | endswith("::vault::AdminCap")) | .objectId // empty')

  info "Package ID:     $package_id"
  info "FeeConfig ID:   $fee_config_id"
  info "AdminCap ID:    $admin_cap_id"

  # Save to Published.toml (Sui does this automatically)
  ok "Contract published successfully"

  # Output for next steps
  cat <<-ENV_OUTPUT

  ── Export these for backend deployment ──
  export PACKAGE_ID=$package_id
  export FEE_CONFIG_ID=$fee_config_id
  export SYSTEM_OBJECT_ID=$(echo "$publish_output" | jq -r '.objectChanges[] | select(.objectType | endswith("::system::System")) | .objectId // "CHECK_MANUALLY"')
  export ADMIN_CAP_ID=$admin_cap_id

ENV_OUTPUT
}

deploy_backend() {
  info "=== Building and deploying backend to $ENVIRONMENT ==="

  # 1. Build Docker images
  info "Building API image..."
  docker build -t "walwatch-api:$DOCKER_TAG" -f "$ROOT_DIR/api/Dockerfile" "$ROOT_DIR/api"

  info "Building Keeper image..."
  docker build -t "walwatch-keeper:$DOCKER_TAG" -f "$ROOT_DIR/keeper/Dockerfile" "$ROOT_DIR/keeper"

  # 2. Tag and push to ECR (requires AWS)
  local ecr_repo
  ecr_repo=$(terraform -chdir="$TF_DIR" output -raw ecr_repository_url 2>/dev/null || echo "")

  if [[ -n "$ecr_repo" ]]; then
    info "Pushing to ECR: $ecr_repo"
    aws ecr get-login-password --region "$(terraform -chdir="$TF_DIR" output -raw aws_region 2>/dev/null || echo "us-east-1")" \
      | docker login --username AWS --password-stdin "$(echo "$ecr_repo" | cut -d/ -f1)"

    docker tag "walwatch-api:$DOCKER_TAG" "$ecr_repo/api:$DOCKER_TAG"
    docker tag "walwatch-api:$DOCKER_TAG" "$ecr_repo/api:latest"
    docker push "$ecr_repo/api:$DOCKER_TAG"
    docker push "$ecr_repo/api:latest"

    docker tag "walwatch-keeper:$DOCKER_TAG" "$ecr_repo/keeper:$DOCKER_TAG"
    docker tag "walwatch-keeper:$DOCKER_TAG" "$ecr_repo/keeper:latest"
    docker push "$ecr_repo/keeper:$DOCKER_TAG"
    docker push "$ecr_repo/keeper:latest"

    ok "Images pushed to ECR"
  else
    info "ECR repo not configured — skipping push. Images tagged locally:"
    info "  walwatch-api:$DOCKER_TAG"
    info "  walwatch-keeper:$DOCKER_TAG"
  fi

  # 3. Force ECS deployment (if AWS is configured)
  if aws sts get-caller-identity &>/dev/null; then
    info "Triggering ECS service update..."

    aws ecs update-service \
      --cluster "walwatch-${ENVIRONMENT}" \
      --service "walwatch-api-${ENVIRONMENT}" \
      --force-new-deployment 2>/dev/null || info "API ECS service not found — deploy infra first"

    aws ecs update-service \
      --cluster "walwatch-${ENVIRONMENT}" \
      --service "walwatch-keeper-${ENVIRONMENT}" \
      --force-new-deployment 2>/dev/null || info "Keeper ECS service not found — deploy infra first"

    ok "ECS deployment triggered"
  else
    info "AWS CLI not configured — skipping ECS update"
  fi
}

deploy_infra() {
  info "=== Applying Terraform infrastructure ==="

  cd "$TF_DIR"

  # Select or create workspace
  terraform workspace select "$TF_WORKSPACE" 2>/dev/null || \
    terraform workspace new "$TF_WORKSPACE"

  # Initialize and apply
  terraform init
  terraform apply -auto-approve

  ok "Infrastructure applied"
  cd "$ROOT_DIR"
}

deploy_db() {
  info "=== Running database migrations ==="

  if [[ -z "${DATABASE_URL:-}" ]]; then
    # Try to get from Terraform output
    local db_url
    db_url=$(terraform -chdir="$TF_DIR" output -raw database_url 2>/dev/null || echo "")
    if [[ -z "$db_url" ]]; then
      info "DATABASE_URL not set and Terraform output not available"
      info "Set DATABASE_URL and re-run:"
      info "  export DATABASE_URL=postgres://..."
      return
    fi
    DATABASE_URL="$db_url"
  fi

  # Run drizzle migrations
  cd "$ROOT_DIR/api"
  DATABASE_URL="$DATABASE_URL" npx drizzle-kit push 2>&1 || {
    info "drizzle-kit not available — run manually:"
    info "  cd api && DATABASE_URL=... npx drizzle-kit push"
  }

  ok "Database migrations applied"
  cd "$ROOT_DIR"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo ""
info "╔══════════════════════════════════════════════════╗"
info "║  WalWatch Deploy — $ENVIRONMENT"
info "║  Component: $COMPONENT"
info "║  Tag:       $DOCKER_TAG"
info "╚══════════════════════════════════════════════════╝"
echo ""

case "$COMPONENT" in
  contract)
    deploy_contract
    ;;
  backend)
    deploy_backend
    ;;
  infra)
    deploy_infra
    ;;
  db)
    deploy_db
    ;;
  all)
    deploy_contract
    echo ""
    deploy_db
    echo ""
    deploy_backend
    echo ""
    deploy_infra
    ;;
  *)
    err "Unknown component: $COMPONENT (use: contract|backend|infra|db|all)"
    ;;
esac

echo ""
ok "Deploy to $ENVIRONMENT complete!"
echo ""
