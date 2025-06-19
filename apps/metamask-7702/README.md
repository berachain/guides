# Berachain MetaMask EIP-7702 Batch Token Approvals

This guide demonstrates how to implement batch token approvals using MetaMask's EIP-7702 functionality on Berachain. The app allows users to approve or revoke multiple token allowances in a single transaction, improving gas efficiency and user experience.

## Prerequisites

- Node.js 18+ installed
- MetaMask browser extension installed
- Berachain testnet configured in MetaMask

## Setup

1. **Install Dependencies**
   ```bash
   cd apps/metamask-7702
   pnpm install
   ```

2. **Start Development Server**
   ```bash
   pnpm dev
   ```

3. **Open in Browser**
   Navigate to `http://localhost:5173`

## MetaMask Configuration

### Adding Berachain Testnet

1. Open MetaMask
2. Go to Settings > Networks > Add Network
3. Add the following details:
   - **Network Name**: Berachain Bepolia
   - **RPC URL**: `https://bepolia.rpc.berachain.com`
   - **Chain ID**: `80085`
   - **Currency Symbol**: `BERA`
   - **Block Explorer URL**: `https://testnet.berascan.com`

## Batch Token Approvals

This guide implements EIP-7702 batch token approvals:

### What is EIP-7702?

EIP-7702 is a proposed Ethereum Improvement Proposal that enables batch transaction processing. In this implementation, we use it to bundle multiple token approval transactions into a single atomic operation.

## Usage

1. **Connect Wallet**: Click "Connect MetaMask" to connect your wallet
2. **Add Approvals**:
   - Select tokens from the dropdown
   - Enter approval amounts
   - Add more tokens as needed
3. **Submit Batch**:
   - Review approval status
   - Click "Approve Tokens" to submit the batch
4. **Reset Approvals**:
   - Use "Reset All Approvals" to revoke permissions

## Development

### Available Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm preview` - Preview production build
- `pnpm lint` - Run ESLint

### Customization

To customize the implementation:

1. **Add Tokens**: Update `TOKENS` array in `App.tsx`
2. **Modify UI**: Edit styles in `global.css`
3. **Extend Features**: Add more batch operations
4. **Update Configuration**: Modify chain config in `main.tsx`

## Troubleshooting

### Common Issues

1. **MetaMask Not Detected**
   - Ensure MetaMask extension is installed
   - Check if MetaMask is unlocked

2. **Network Issues**
   - Verify Berachain testnet configuration
   - Check RPC endpoint availability
   - Ensure you have testnet tokens

3. **Approval Failures**
   - Check token balances
   - Verify spender address format
   - Ensure sufficient gas for batch transaction

## Resources

- [Berachain Documentation](https://docs.berachain.com/)
- [EIP-7702 Specification](https://eips.ethereum.org/EIPS/eip-7702)
- [MetaMask Documentation](https://docs.metamask.io/)
- [wagmi Documentation](https://wagmi.sh/) 