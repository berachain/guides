export async function jsonRpc(rpcUrl, method, params = [], fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } catch (error) {
    throw new Error(`RPC ${method} unreachable at ${rpcUrl}: ${error.message}`);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`RPC ${method} HTTP ${response.status} from ${rpcUrl}: ${body.slice(0, 200)}`);
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`RPC ${method} returned non-JSON from ${rpcUrl}: ${body.slice(0, 200)}`);
  }

  if (json.error) {
    const message = json.error.message || JSON.stringify(json.error);
    throw new Error(`RPC ${method} error from ${rpcUrl}: ${message}`);
  }

  return json.result;
}
