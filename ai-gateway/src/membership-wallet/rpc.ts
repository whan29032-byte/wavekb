import { WalletRpcError } from "./contracts.ts";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
async function responseJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES) throw new WalletRpcError("rpc_response_invalid");
  if (!response.body) throw new WalletRpcError("rpc_response_invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new WalletRpcError("rpc_response_invalid"); }
      chunks.push(next.value);
    }
    const bytes = Buffer.concat(chunks);
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof WalletRpcError) throw error;
    throw new WalletRpcError("rpc_response_invalid");
  } finally { reader.releaseLock(); }
}
export async function walletRpcRequest(url: string, body: unknown, dependencies: {
  fetch?: typeof fetch; timeoutMs: number; headers?: Record<string, string>; signal?: AbortSignal;
}): Promise<unknown> {
  try {
    const timeout = AbortSignal.timeout(dependencies.timeoutMs);
    const response = await (dependencies.fetch ?? fetch)(url, { method: "POST", redirect: "error",
      headers: { "content-type": "application/json", ...dependencies.headers }, body: JSON.stringify(body),
      signal: dependencies.signal ? AbortSignal.any([timeout, dependencies.signal]) : timeout });
    if (!response.ok) {
      const delay = Number(response.headers.get("retry-after") || 60);
      throw new WalletRpcError(response.status === 429 ? "rpc_rate_limited" : "rpc_unavailable", Number.isFinite(delay) ? delay : 60);
    }
    return await responseJson(response);
  } catch (error) {
    if (error instanceof WalletRpcError) throw error;
    // Do not propagate fetch exceptions, URLs, query strings or provider keys.
    throw new WalletRpcError("rpc_unavailable");
  }
}
export class EvmReadRpc {
  private nextId = 0;
  private readonly endpoint: string;
  private readonly dependencies: Parameters<typeof walletRpcRequest>[2];
  constructor(endpoint: string, dependencies: Parameters<typeof walletRpcRequest>[2]) { this.endpoint = endpoint; this.dependencies = dependencies; }
  async call(method: string, params: unknown[]): Promise<unknown> {
    // Only read methods needed to prove one transfer are ever callable.
    if (!["eth_chainId", "eth_getTransactionReceipt", "eth_getBlockByNumber"].includes(method)) throw new WalletRpcError("rpc_method_invalid");
    const id = ++this.nextId;
    const data = await walletRpcRequest(this.endpoint, { jsonrpc: "2.0", id, method, params }, this.dependencies) as Record<string, unknown> | null;
    if (!data || data.jsonrpc !== "2.0" || data.id !== id || data.error || !Object.hasOwn(data, "result")) throw new WalletRpcError("rpc_response_invalid");
    return data.result;
  }
}
