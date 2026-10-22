// Shared SerpApi request helper: one place for the endpoint, timeout and error handling.
export const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

export async function serpApiGet<T extends { error?: string }>(
  params: URLSearchParams,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${SERPAPI_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000) });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}
