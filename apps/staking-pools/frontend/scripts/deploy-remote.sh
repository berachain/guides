#!/usr/bin/env bash
# Deploy staking-pool frontend for Bepolia, Mainnet, and Rhino mainnet to cam@37.27.231.195,
# then start static servers on ports 6900 (Bepolia), 6901 (Mainnet), 6902 (Rhino mainnet).
# On the remote, kills any process holding 6900/6901/6902 before starting serve.
# Run from repo root: guides/apps/staking-pools/frontend/scripts/deploy-remote.sh
# Or from frontend: ./scripts/deploy-remote.sh

set -e

REMOTE="cam@37.27.231.195"
FRONTEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAGING_DIR="${FRONTEND_DIR}/../deploy-out"
BEPOLIA_DIR="${STAGING_DIR}/staking-pools-bepolia"
MAINNET_DIR="${STAGING_DIR}/staking-pools-mainnet"
RHINO_MAINNET_DIR="${STAGING_DIR}/staking-pools-rhino-mainnet"

cd "$FRONTEND_DIR"

echo "Building Bepolia (discovery, teal)..."
cp public/config.deploy.bepolia.json public/config.json
npm run build
rm -rf "$BEPOLIA_DIR"
mkdir -p "$BEPOLIA_DIR"
cp -r dist/. "$BEPOLIA_DIR/"
cp public/config.deploy.bepolia.json "$BEPOLIA_DIR/config.json"
test -f "$BEPOLIA_DIR/index.html" && test -d "$BEPOLIA_DIR/assets" || { echo "Bepolia build missing index or assets"; exit 1; }

echo "Building Mainnet (discovery, coral)..."
cp public/config.deploy.mainnet.json public/config.json
npm run build
rm -rf "$MAINNET_DIR"
mkdir -p "$MAINNET_DIR"
cp -r dist/. "$MAINNET_DIR/"
cp public/config.deploy.mainnet.json "$MAINNET_DIR/config.json"
test -f "$MAINNET_DIR/index.html" && test -d "$MAINNET_DIR/assets" || { echo "Mainnet build missing index or assets"; exit 1; }

echo "Building Rhino mainnet (single-pool, slate)..."
cp public/config.deploy.rhino-mainnet.json public/config.json
npm run build
rm -rf "$RHINO_MAINNET_DIR"
mkdir -p "$RHINO_MAINNET_DIR"
cp -r dist/. "$RHINO_MAINNET_DIR/"
cp public/config.deploy.rhino-mainnet.json "$RHINO_MAINNET_DIR/config.json"
test -f "$RHINO_MAINNET_DIR/index.html" && test -d "$RHINO_MAINNET_DIR/assets" || { echo "Rhino mainnet build missing index or assets"; exit 1; }

# Restore original config if it existed
if [[ -f public/config.json ]]; then
  if cmp -s public/config.deploy.bepolia.json public/config.json; then
    : # leave bepolia in place
  elif cmp -s public/config.deploy.mainnet.json public/config.json; then
    cp public/config.deploy.bepolia.json public/config.json
  elif cmp -s public/config.deploy.rhino-mainnet.json public/config.json; then
    cp public/config.deploy.bepolia.json public/config.json
  fi
fi

echo "Syncing to ${REMOTE}..."
ssh "$REMOTE" 'mkdir -p ~/deployed/staking-pools-bepolia ~/deployed/staking-pools-mainnet ~/deployed/staking-pools-rhino-mainnet'
rsync -avz --delete "$BEPOLIA_DIR/" "${REMOTE}:~/deployed/staking-pools-bepolia/"
rsync -avz --delete "$MAINNET_DIR/" "${REMOTE}:~/deployed/staking-pools-mainnet/"
rsync -avz --delete "$RHINO_MAINNET_DIR/" "${REMOTE}:~/deployed/staking-pools-rhino-mainnet/"

echo "Killing processes on 6900/6901/6902 and starting serve..."
ssh "$REMOTE" 'for p in 6900 6901 6902; do pid=$(lsof -ti:$p 2>/dev/null); [ -n "$pid" ] && kill -9 $pid 2>/dev/null || true; done
  sleep 1
  (cd ~/deployed/staking-pools-bepolia && nohup npx -y serve -s . -l 6900 > serve.log 2>&1 &)
  (cd ~/deployed/staking-pools-mainnet && nohup npx -y serve -s . -l 6901 > serve.log 2>&1 &)
  (cd ~/deployed/staking-pools-rhino-mainnet && nohup npx -y serve -s . -l 6902 > serve.log 2>&1 &)
  sleep 2
  echo "Bepolia:       http://37.27.231.195:6900"
  echo "Mainnet:       http://37.27.231.195:6901"
  echo "Rhino mainnet: http://37.27.231.195:6902"
'
