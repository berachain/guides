#!/usr/bin/env bash
# Deploy staking-pool frontend for Bepolia and Mainnet to cam@37.27.231.195,
# then start static servers on ports 6900 (Bepolia) and 6901 (Mainnet).
# Run from repo root: guides/apps/staking-pools/frontend/scripts/deploy-remote.sh
# Or from frontend: ./scripts/deploy-remote.sh

set -e

REMOTE="cam@37.27.231.195"
FRONTEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAGING_DIR="${FRONTEND_DIR}/../deploy-out"
BEPOLIA_DIR="${STAGING_DIR}/staking-pools-bepolia"
MAINNET_DIR="${STAGING_DIR}/staking-pools-mainnet"

cd "$FRONTEND_DIR"

echo "Building Bepolia (discovery, teal)..."
cp public/config.deploy.bepolia.json public/config.json
npm run build
rm -rf "$BEPOLIA_DIR"
mkdir -p "$(dirname "$BEPOLIA_DIR")"
cp -r dist "$BEPOLIA_DIR"

echo "Building Mainnet (discovery, coral)..."
cp public/config.deploy.mainnet.json public/config.json
npm run build
rm -rf "$MAINNET_DIR"
mkdir -p "$(dirname "$MAINNET_DIR")"
cp -r dist "$MAINNET_DIR"

# Restore original config if it existed
if [[ -f public/config.json ]]; then
  if cmp -s public/config.deploy.bepolia.json public/config.json; then
    : # leave bepolia in place
  elif cmp -s public/config.deploy.mainnet.json public/config.json; then
    cp public/config.deploy.bepolia.json public/config.json
  fi
fi

echo "Syncing to ${REMOTE}..."
ssh "$REMOTE" 'mkdir -p ~/deployed/staking-pools-bepolia ~/deployed/staking-pools-mainnet'
rsync -avz --delete "$BEPOLIA_DIR/" "${REMOTE}:~/deployed/staking-pools-bepolia/"
rsync -avz --delete "$MAINNET_DIR/" "${REMOTE}:~/deployed/staking-pools-mainnet/"

echo "Starting servers on remote (6900 = Bepolia, 6901 = Mainnet)..."
ssh "$REMOTE" 'mkdir -p ~/deployed/staking-pools-bepolia ~/deployed/staking-pools-mainnet
  (cd ~/deployed/staking-pools-bepolia && (pkill -f "serve.*6900" 2>/dev/null || true); nohup npx -y serve -s . -l 6900 > serve.log 2>&1 &)
  (cd ~/deployed/staking-pools-mainnet && (pkill -f "serve.*6901" 2>/dev/null || true); nohup npx -y serve -s . -l 6901 > serve.log 2>&1 &)
  sleep 2
  echo "Bepolia:  http://37.27.231.195:6900"
  echo "Mainnet: http://37.27.231.195:6901"
'
