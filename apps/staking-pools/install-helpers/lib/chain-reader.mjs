import { ethers } from './ethers-bundle.mjs';
import { jsonRpc } from './rpc.mjs';
import { formatWeiToDecimal } from './format.mjs';

export function createChainReader(rpcUrl, fetchImpl = globalThis.fetch) {
  return {
    rpcUrl,
    fetchImpl,
    call: (target, signature, args = [], options = {}) =>
      ethCall(rpcUrl, target, signature, args, options, fetchImpl),
    getCode: (address) => jsonRpc(rpcUrl, 'eth_getCode', [address, 'latest'], fetchImpl),
    getBlockNumber: () => jsonRpc(rpcUrl, 'eth_blockNumber', [], fetchImpl),
    getBalance: (address) => jsonRpc(rpcUrl, 'eth_getBalance', [address, 'latest'], fetchImpl),
    getBlockByNumber: (blockNumber, full = true) =>
      jsonRpc(rpcUrl, 'eth_getBlockByNumber', [toBlockTag(blockNumber), full], fetchImpl),
    formatWei: (wei, unit = 'ether') => formatWeiToDecimal(wei, unit),
    sendRawTransaction: (rawTx) => jsonRpc(rpcUrl, 'eth_sendRawTransaction', [rawTx], fetchImpl),
    getTransactionReceipt: (hash) =>
      jsonRpc(rpcUrl, 'eth_getTransactionReceipt', [hash], fetchImpl),
    estimateGas: (tx) => jsonRpc(rpcUrl, 'eth_estimateGas', [tx], fetchImpl),
    getChainId: () => jsonRpc(rpcUrl, 'eth_chainId', [], fetchImpl),
  };
}

function toBlockTag(blockNumber) {
  if (typeof blockNumber === 'string' && blockNumber.startsWith('0x')) {
    return blockNumber;
  }
  return ethers.toBeHex(BigInt(blockNumber));
}

function splitCastSignature(signature) {
  const endReturns = signature.match(/^(.+)\)\(([^()]+)\)$/);
  if (endReturns) {
    const head = endReturns[1];
    const open = head.indexOf('(');
    return {
      name: head.slice(0, open),
      inputs: head.slice(open + 1),
      returns: endReturns[2],
    };
  }
  const open = signature.indexOf('(');
  return {
    name: signature.slice(0, open),
    inputs: signature.slice(open + 1, -1),
    returns: null,
  };
}

function toEthersSignature(signature) {
  const parts = splitCastSignature(signature);
  if (parts.returns) {
    return `function ${parts.name}(${parts.inputs}) returns (${parts.returns})`;
  }
  return `function ${parts.name}(${parts.inputs})`;
}

function functionFragmentName(signature) {
  const parts = splitCastSignature(signature);
  return `${parts.name}(${parts.inputs})`;
}

function ifaceFor(signature) {
  return new ethers.Interface([toEthersSignature(signature)]);
}

export async function ethCall(rpcUrl, target, signature, args = [], options = {}, fetchImpl = globalThis.fetch) {
  const iface = ifaceFor(signature);
  const data = iface.encodeFunctionData(functionFragmentName(signature), args);
  const callTx = { to: target, data };
  if (options.from) {
    callTx.from = options.from;
  }
  if (options.value) {
    callTx.value = ethers.toBeHex(ethers.getBigInt(options.value));
  }

  try {
    const raw = await jsonRpc(rpcUrl, 'eth_call', [callTx, 'latest'], fetchImpl);
    if (!raw || raw === '0x') {
      return { raw, decoded: null };
    }
    const decoded = iface.decodeFunctionResult(functionFragmentName(signature), raw);
    return { raw, decoded };
  } catch (error) {
    const message = error.message || String(error);
    if (options.allowRevert) {
      return { raw: null, decoded: null, revertMessage: message };
    }
    throw error;
  }
}

export async function ethCallRevertData(rpcUrl, target, signature, args = [], options = {}, fetchImpl = globalThis.fetch) {
  const iface = ifaceFor(signature);
  const data = iface.encodeFunctionData(functionFragmentName(signature), args);
  const callTx = { to: target, data };
  if (options.from) callTx.from = options.from;
  if (options.value) callTx.value = ethers.toBeHex(ethers.getBigInt(options.value));

  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [callTx, 'latest'],
      }),
    });
  } catch (error) {
    throw new Error(`RPC eth_call unreachable at ${rpcUrl}: ${error.message}`);
  }

  const body = await response.text();
  const json = JSON.parse(body);
  if (!json.error) {
    const decoded = iface.decodeFunctionResult(functionFragmentName(signature), json.result);
    return { ok: true, decoded, message: '' };
  }

  const message = json.error.message || JSON.stringify(json.error);
  const dataMatch = String(json.error.data || message).match(/0x[0-9a-fA-F]+/);
  return { ok: false, decoded: null, message, revertData: dataMatch?.[0] ?? '' };
}

export function encodeFunctionData(signature, args = []) {
  const iface = ifaceFor(signature);
  return iface.encodeFunctionData(functionFragmentName(signature), args);
}

export function formatCalldataArgsForCast(signature, args = []) {
  const iface = ifaceFor(signature);
  const fragment = iface.getFunction(signature.split('(')[0]);
  return fragment.format('minimal').includes('(')
    ? formatCastArgsFromValues(fragment, args)
    : args.map(castFormatValue).join(' ');
}

function formatCastArgsFromValues(fragment, args) {
  const formatted = [];
  let argIndex = 0;
  for (const input of fragment.inputs) {
  if (input.baseType === 'tuple' && input.components) {
      const tupleValues = args[argIndex];
      const inner = input.components
        .map((component, idx) => castFormatValue(tupleValues[idx], component.type))
        .join(',');
      formatted.push(`(${inner})`);
      argIndex += 1;
    } else {
      formatted.push(castFormatValue(args[argIndex], input.type));
      argIndex += 1;
    }
  }
  return formatted.join(' ');
}

function castFormatValue(value, type = '') {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => castFormatValue(entry)).join(',')}]`;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (type.startsWith('uint') || type.startsWith('int')) {
    return String(value);
  }
  return String(value);
}

export function walletFromPrivateKey(privateKey) {
  return new ethers.Wallet(privateKey);
}

export async function walletAddressFromPrivateKey(privateKey) {
  const wallet = walletFromPrivateKey(privateKey);
  return wallet.address.toLowerCase();
}

export async function sendContractTransaction({
  rpcUrl,
  privateKey,
  to,
  signature,
  args = [],
  value = 0n,
  fetchImpl = globalThis.fetch,
}) {
  const wallet = walletFromPrivateKey(privateKey);
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, fetchOptions: { dispatcher: undefined } });
  const connected = wallet.connect(provider);
  const iface = ifaceFor(signature);
  const data = iface.encodeFunctionData(functionFragmentName(signature), args);
  const tx = await connected.sendTransaction({
    to,
    data,
    value,
    type: 0,
  });
  const receipt = await tx.wait();
  return { hash: tx.hash, receipt };
}
