const DEPLOY_REVERTS = new Map([
  ['0xc4142b41', 'OperatorAlreadySet() — operator already registered for this validator'],
  ['0xccea9e6f', 'InvalidOperator() — operator address invalid or mismatched'],
  ['0x9be73159', 'InvalidWithdrawalCredentials() — withdrawal credentials do not match factory'],
  ['0xe6c4247b', 'InvalidAddress() — zero or invalid address argument'],
  ['0x29829bdd', 'InvalidFirstDepositAmount() — deposit amount below minimum'],
  ['0x7b5d09a5', 'InvalidInitialDepositAmount() — validator balance below activation floor'],
  ['0xb7d09497', 'InvalidTimestamp() — proof timestamp invalid or expired'],
]);

const ACTIVATION_REVERTS = new Map([
  ['0x7b5d09a5', 'InvalidInitialDepositAmount() — validator balance < 10000 ether (gwei units)'],
  ['0xccea9e6f', 'InvalidOperator() — BeaconDeposit.getOperator(pubkey) != coreContracts.smartOperator'],
  ['0x9be73159', 'InvalidWithdrawalCredentials() — validator WC != 0x010000…||withdrawalVault'],
  ['0xb7d09497', 'InvalidTimestamp() — proof timestamp in the future or > 10 minutes old'],
  ['0xa7baf889', 'InvalidBeaconBlockRoot() — EIP-4788 has no root for this timestamp (buffer miss)'],
  ['0x09bde339', 'InvalidProof() — SSZ proof does not verify against the beacon block root'],
  ['0xc52e3eff', 'InvalidBalance() — balanceLeaf does not encode the claimed validator balance'],
  ['0x1390f2a1', 'IndexOutOfRange() — validatorIndex outside the registry limit'],
  ['0x6cbf06ef', 'StakingPoolAlreadyActivated() — pool.isActive() is already true'],
]);

function decodeRevertMap(message, revertMap) {
  const lower = String(message ?? '').toLowerCase();
  for (const [selector, label] of revertMap.entries()) {
    if (lower.includes(selector.slice(2)) || lower.includes(selector)) {
      return label;
    }
  }
  return message;
}

export function decodeDeployRevert(message) {
  return decodeRevertMap(message, DEPLOY_REVERTS);
}

export function decodeActivationRevert(message) {
  return decodeRevertMap(message, ACTIVATION_REVERTS);
}

export function extractRevertSelector(message) {
  const match = String(message ?? '').match(/0x[0-9a-fA-F]{8}/);
  return match ? match[0].toLowerCase() : '';
}
