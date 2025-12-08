# LayerZero OFT Implementation Plan: Base to Berachain Bridging Guide

## Executive Summary

This document outlines the plan to create a comprehensive, easy-to-follow guide for bridging ERC20 tokens from Base to Berachain using LayerZero V2's Omnichain Fungible Token (OFT) standard with Foundry/Forge. The guide will follow the official LayerZero documentation patterns and provide default configurations for seamless setup.

## Current State Analysis

### What We Have

1. **Basic Contract Structure**
   - `MyToken.sol` - Custom ERC20 token with minting capability
   - `MyAdapter.sol` - OFTAdapter for existing tokens (Base side)
   - `MyOFT.sol` - OFT contract for destination chain (Berachain side)

2. **Deployment Scripts**
   - `MyToken.s.sol` - Token deployment script
   - `MyAdapter.s.sol` - Adapter deployment script
   - `MyOFT.s.sol` - OFT deployment script with peer setup
   - `Bridge.s.sol` - Token bridging script

3. **Configuration**
   - Basic `.env.example` with endpoint addresses and DVN addresses
   - Foundry configuration with basic remappings
   - Endpoint IDs and DVN addresses documented

### What's Missing (Based on LayerZero Documentation)

1. **Foundry Setup Alignment**
   - Proper remappings matching LayerZero documentation format
   - Missing `solidity-bytes-utils` library setup
   - Library installation verification

2. **Library Configuration**
   - Scripts to discover and set send/receive libraries
   - Default library addresses for Base and Berachain
   - Library configuration automation

3. **DVN Configuration Scripts**
   - Automated DVN configuration for both chains
   - Receive configuration setup (currently mentioned but scripts missing)
   - Send configuration setup

4. **Complete Wiring Process**
   - Peer setup verification
   - Bidirectional peer configuration
   - Configuration verification scripts

5. **Documentation Gaps**
   - Step-by-step Foundry installation verification
   - Library discovery process
   - Complete configuration workflow
   - Troubleshooting guide aligned with LayerZero docs

## Implementation Plan

### Phase 1: Foundry Setup & Dependencies

#### 1.1 Update `foundry.toml`
Align with LayerZero documentation's Foundry setup:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib", "node_modules"]

remappings = [
    '@layerzerolabs/oft-evm/=lib/devtools/packages/oft-evm/',
    '@layerzerolabs/oapp-evm/=lib/devtools/packages/oapp-evm/',
    '@layerzerolabs/lz-evm-protocol-v2/=lib/LayerZero-v2/packages/layerzero-v2/evm/protocol',
    '@layerzerolabs/lz-evm-messagelib-v2/=lib/LayerZero-v2/packages/layerzero-v2/evm/messagelib',
    '@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/',
    'solidity-bytes-utils/=lib/solidity-bytes-utils/',
    'forge-std/=lib/forge-std/src/',
]
```

**Note**: Current setup uses npm packages, but documentation shows git submodules. We need to:
- Either switch to git submodules (more aligned with docs)
- Or update remappings to use `node_modules` paths (current approach)
- Document both approaches

#### 1.2 Verify Library Installation
Create a verification script to check all required libraries are installed:
- `forge-std`
- `LayerZero-v2`
- `openzeppelin-contracts`
- `solidity-bytes-utils`
- `devtools` (if using submodules)

#### 1.3 Installation Script
Create a setup script that:
- Checks Foundry installation
- Installs missing dependencies
- Verifies remappings work correctly

### Phase 2: Library Discovery & Configuration

#### 2.1 Library Discovery Scripts
Create scripts to discover default libraries for each chain:

**`script/GetBaseLibraries.s.sol`**
- Queries Base endpoint for default send/receive libraries
- Outputs library addresses for configuration
- Stores results for use in configuration scripts

**`script/GetBerachainLibraries.s.sol`**
- Queries Berachain endpoint for default send/receive libraries
- Outputs library addresses for configuration

#### 2.2 Library Configuration Scripts
Create scripts to set libraries:

**`script/SetBaseLibraries.s.sol`**
- Sets send library for Base adapter
- Sets receive library for Base adapter
- Configures default library settings

**`script/SetBerachainLibraries.s.sol`**
- Sets send library for Berachain OFT
- Sets receive library for Berachain OFT
- Configures default library settings

#### 2.3 Default Library Addresses
Research and document default library addresses:
- Base default libraries (from LayerZero docs or endpoint queries)
- Berachain default libraries
- Add to `.env.example` with instructions on how to discover them

### Phase 3: DVN Configuration

#### 3.1 DVN Configuration Scripts
Create comprehensive DVN setup scripts:

**`script/ConfigureBaseDVNs.s.sol`**
- Configures receive DVNs for Base adapter
- Sets required DVNs (LayerZero, Nethermind)
- Sets optional DVNs if applicable
- Configures confirmation requirements

**`script/ConfigureBerachainDVNs.s.sol`**
- Configures receive DVNs for Berachain OFT
- Sets required DVNs (LayerZero, Nethermind)
- Sets optional DVN (BERA DVN)
- Configures confirmation requirements

**`script/ConfigureAllDVNs.s.sol`**
- Combined script to configure both chains
- Handles cross-chain configuration
- Verifies configurations

#### 3.2 DVN Configuration Details
Based on documentation, configure:
- **Required DVNs**: Must verify messages
- **Optional DVNs**: Can verify but not required
- **Confirmations**: Number of confirmations needed
- **Grace Period**: Time window for message verification

### Phase 4: Complete Wiring & Peer Setup

#### 4.1 Enhanced Peer Configuration
Update existing scripts to:
- Verify peer connections before bridging
- Set bidirectional peers (Base ↔ Berachain)
- Validate peer addresses

#### 4.2 Configuration Verification Scripts
Create scripts to verify setup:

**`script/VerifyConfiguration.s.sol`**
- Checks peer connections
- Verifies library configurations
- Validates DVN settings
- Outputs configuration status

#### 4.3 Complete Setup Script
Create an all-in-one setup script:

**`script/CompleteSetup.s.sol`**
- Deploys all contracts (if not already deployed)
- Sets peers
- Configures libraries
- Configures DVNs
- Verifies complete setup
- Outputs summary

### Phase 5: Enhanced Deployment Scripts

#### 5.1 Update Existing Scripts
Enhance current deployment scripts:

**`script/MyAdapter.s.sol`**
- Add peer setup to Berachain OFT
- Add library configuration option
- Add verification steps

**`script/MyOFT.s.sol`**
- Verify Base adapter address
- Add library configuration
- Add verification steps

#### 5.2 Environment Variable Management
Improve `.env.example`:
- Add all discovered library addresses
- Add configuration flags
- Add verification addresses
- Add comprehensive comments

### Phase 6: Documentation Updates

#### 6.1 README.md Restructure
Create comprehensive guide following LayerZero documentation structure:

1. **Introduction**
   - What is OFT
   - Use case: Bridging existing tokens
   - Architecture overview

2. **Prerequisites**
   - Foundry installation (with verification steps)
   - Node.js requirements
   - Wallet setup (Base and Berachain)
   - Token requirements

3. **Installation**
   - Foundry setup verification
   - Dependency installation
   - Remapping verification
   - Environment setup

4. **Deployment Guide**
   - Step 1: Deploy Token (Base)
   - Step 2: Deploy Adapter (Base)
   - Step 3: Deploy OFT (Berachain)
   - Step 4: Configure Libraries
   - Step 5: Configure DVNs
   - Step 6: Set Peers
   - Step 7: Verify Configuration
   - Step 8: Bridge Tokens

5. **Configuration Details**
   - Library addresses and discovery
   - DVN addresses and requirements
   - Endpoint addresses
   - Chain IDs and Endpoint IDs

6. **Usage Examples**
   - Basic bridging
   - Checking balances
   - Verifying transactions
   - Troubleshooting common issues

7. **Troubleshooting**
   - Common errors and solutions
   - DVN mismatch errors
   - Library configuration issues
   - Peer connection problems

#### 6.2 Create WALKTHROUGH.md
Detailed walkthrough document:
- Step-by-step with expected outputs
- Screenshots/terminal outputs
- Common pitfalls
- Verification steps at each stage

#### 6.3 Create QUICKSTART.md
Quick reference guide:
- Minimal setup commands
- Default configurations
- One-command deployment (if possible)

### Phase 7: Testing & Validation

#### 7.1 Test Scripts
Create test scripts to validate:
- Contract deployments
- Configuration correctness
- Bridge functionality
- Error handling

#### 7.2 Validation Checklist
Create checklist for users:
- [ ] Foundry installed and verified
- [ ] Dependencies installed
- [ ] Environment variables set
- [ ] Token deployed
- [ ] Adapter deployed
- [ ] OFT deployed
- [ ] Libraries configured
- [ ] DVNs configured
- [ ] Peers set
- [ ] Configuration verified
- [ ] Test bridge successful

## Default Configurations for Base → Berachain

### Endpoint Addresses
- **Base Endpoint**: `0x1a44076050125825900e736c501f859c50fE728c`
- **Berachain Endpoint**: `0x6F475642a6e85809B1c36Fa62763669b1b48DD5B`

### Endpoint IDs (EIDs)
- **Base EID**: `30110`
- **Berachain EID**: `30362`

### DVN Addresses

**Base DVNs:**
- LayerZero DVN: `0x9e059a54699a285714207b43b055483e78faac25`
- Nethermind DVN: `0xcd37ca043f8479064e10635020c65ffc005d36f6`

**Berachain DVNs:**
- LayerZero DVN: `0x282b3386571f7f794450d5789911a9804fa346b4`
- Nethermind DVN: `0xdd7b5e1db4aafd5c8ec3b764efb8ed265aa5445b`
- Optional BERA DVN: `0x10473bd2f7320476b5e5e59649e3dc129d9d0029`

### Library Addresses
**To be discovered via scripts:**
- Base default send library
- Base default receive library
- Berachain default send library
- Berachain default receive library

### RPC URLs
- **Base**: `https://mainnet.base.org`
- **Berachain**: `https://rpc.berachain.com/`

## Implementation Priority

### High Priority (Must Have)
1. ✅ Library discovery scripts
2. ✅ Library configuration scripts
3. ✅ DVN configuration scripts
4. ✅ Configuration verification
5. ✅ Updated README with complete workflow

### Medium Priority (Should Have)
1. Complete setup automation script
2. Enhanced error handling
3. Detailed troubleshooting guide
4. WALKTHROUGH.md document

### Low Priority (Nice to Have)
1. Quickstart guide
2. Test scripts
3. Deployment automation
4. Multi-chain support documentation

## Key Considerations

### Package Management
**Decision needed**: Use npm packages (current) or git submodules (documentation style)?

**Recommendation**: 
- Keep npm packages for easier dependency management
- Update remappings to work with npm structure
- Document both approaches

### Library Discovery
**Approach**: 
- Create scripts to query endpoints for default libraries
- Cache results in `.env` file
- Provide fallback to manual configuration

### Configuration Order
**Critical sequence**:
1. Deploy contracts
2. Set peers (bidirectional)
3. Configure libraries (send and receive)
4. Configure DVNs (receive configs)
5. Verify all configurations
6. Test bridge

### Error Prevention
- Add validation checks at each step
- Verify configurations before allowing bridging
- Provide clear error messages
- Include troubleshooting links

## Success Criteria

1. ✅ User can follow guide end-to-end without external help
2. ✅ All configurations are automated or clearly documented
3. ✅ Default values work for Base → Berachain bridging
4. ✅ Common errors are prevented or easily resolved
5. ✅ Guide aligns with LayerZero official documentation patterns
6. ✅ Foundry/Forge setup matches documentation examples

## Next Steps

1. Review and approve this plan
2. Begin Phase 1: Foundry setup alignment
3. Implement library discovery scripts
4. Create DVN configuration scripts
5. Update documentation
6. Test complete workflow
7. Gather feedback and iterate

## References

- [LayerZero V2 OFT Quickstart](https://docs.layerzero.network/v2/developers/evm/oft/quickstart)
- [LayerZero V2 Protocol Contracts](https://docs.layerzero.network/v2/deployments/contracts)
- [LayerZero DVN Configuration](https://docs.layerzero.network/v2/developers/evm/technical-reference/dvn-executor-config)
- [Foundry Book](https://book.getfoundry.sh/)

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-27  
**Status**: Planning Phase

