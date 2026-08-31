export function classifyPoolPhase({ fullyExited, poolActive, beacon }) {
  if (fullyExited) {
    return {
      phase: 'fully_exited',
      headline: 'Staking pool is FULLY EXITED',
      next: '',
    };
  }
  if (poolActive) {
    return {
      phase: 'pool_active',
      headline: 'Staking pool is ACTIVE',
      next: '',
    };
  }
  if (beacon?.error) {
    return {
      phase: 'cl_unreachable',
      headline: 'Pool contract is not activated (isActive=false)',
      next: `Could not read beacon state: ${beacon.error}. Set CL_NODE_API_URL to the Node API. Re-run status before activate.`,
    };
  }
  if (!beacon?.found) {
    return {
      phase: 'awaiting_beacon',
      headline: 'EL operator is registered. Beacon head state does not include this validator yet.',
      next: 'Wait until the beacon chain includes the validator. Re-run status. Do not run activate yet.',
    };
  }
  return {
    phase: 'ready_to_activate',
    headline: `Beacon has this validator (index ${beacon.index}, status ${beacon.status}). Ready for activation.`,
    next: 'Run: node pool-cli.mjs activate',
  };
}

export function detectInstallPhase({
  deployed,
  fullyExited,
  poolActive,
  beacon,
  stakeTargetBera,
  stakeComplete,
}) {
  if (fullyExited) {
    return 'fully_exited';
  }
  if (!deployed) {
    return 'not_deployed';
  }
  if (beacon?.error) {
    return 'cl_unreachable';
  }
  if (!beacon?.found) {
    return 'deposited_awaiting_registration';
  }
  if (!poolActive) {
    return 'registered_awaiting_activation';
  }
  const target = BigInt(stakeTargetBera || '0');
  if (target > 0n && !stakeComplete) {
    return 'active_under_stake_target';
  }
  return 'done';
}
