#!/bin/bash

# Setup script for Honey Token Demo

echo "🚀 Setting up Honey Token Demo..."

# Check if Foundry is installed
if ! command -v forge &> /dev/null; then
    echo "❌ Foundry not found. Please install Foundry first:"
    echo "   curl -L https://foundry.paradigm.xyz | bash"
    exit 1
fi

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
    echo "❌ Bun not found. Please install Bun first:"
    echo "   curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo "✓ Foundry and Bun are installed"

# Create .env from .env.example if it doesn't exist
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    echo "📝 Creating .env from .env.example..."
    cp .env.example .env
    echo "✓ .env created with default Anvil keys"
fi

# Setup contracts
echo ""
echo "📦 Setting up contracts..."
cd contracts

# Initialize git if not already initialized (needed for forge install)
if [ ! -d "../.git" ]; then
    echo "📝 Initializing git repository (required for forge install)..."
    cd ..
    git init > /dev/null 2>&1
    cd contracts
fi

# Check if forge-std is installed, install if not
if [ ! -d "lib/forge-std" ]; then
    echo "📥 Installing forge-std..."
    forge install foundry-rs/forge-std > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✓ forge-std installed"
    else
        echo "⚠️  Failed to install forge-std."
        forge install foundry-rs/forge-std 2>&1 | head -5
    fi
fi

# Check if OpenZeppelin is installed, install if not
if [ ! -d "lib/openzeppelin-contracts" ]; then
    echo "📥 Installing OpenZeppelin contracts..."
    forge install OpenZeppelin/openzeppelin-contracts > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✓ OpenZeppelin contracts installed"
    else
        echo "⚠️  Failed to install OpenZeppelin contracts automatically."
        echo "   Please run manually: forge install OpenZeppelin/openzeppelin-contracts"
        exit 1
    fi
else
    echo "✓ OpenZeppelin contracts found"
fi

# Build contracts
echo "🔨 Building contracts..."
forge build
if [ $? -eq 0 ]; then
    echo "✓ Contracts compiled successfully"
else
    echo "❌ Contract compilation failed. Please check the errors above."
    exit 1
fi

cd ..

# Setup frontend
echo ""
echo "📦 Setting up frontend..."
cd frontend

echo "📥 Installing dependencies..."
bun install

# Copy deployments.json if it exists
if [ -f "../contracts/deployments.json" ]; then
    echo "📋 Copying deployments.json to public directory..."
    cp ../contracts/deployments.json ./public/
    echo "✓ deployments.json copied"
else
    echo "⚠️  deployments.json not found. Deploy contracts first."
fi

cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start Anvil (in a separate terminal): anvil"
echo ""
echo "2. Deploy contracts:"
echo "   cd contracts"
echo "   forge script script/Deploy.s.sol:DeployScript --rpc-url http://localhost:8545 --broadcast"
echo ""
echo "3. Copy deployments.json: cp contracts/deployments.json frontend/public/"
echo ""
echo "4. Start frontend: cd frontend && bun run dev"
echo ""
echo "The .env file uses Anvil default keys:"
echo "  PRIVATE_KEY          → Token Holder (signs, no gas)"
echo "  PRIVATE_KEY_GAS_SUBSIDIZER → Gas Subsidizer (executes, pays gas)"
echo "  DEPLOYER_PRIVATE_KEY → Contract deployer"
