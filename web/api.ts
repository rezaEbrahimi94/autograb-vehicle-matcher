import {
  json,
  parseApiError,
  parseMatchRequest,
  parseMatchResponse,
  parseStatusResponse,
  type MatchResponse,
  type StatusResponse,
} from '../src/contracts.js';
/** One typed client boundary; UI code never trusts an unvalidated JSON object. */
export function createApi(fetchImpl: typeof fetch = fetch) {
  async function request(path: string, payload?: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetchImpl(path, {
      ...(signal ? { signal } : {}),
      ...(payload === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parseMatchRequest(payload)),
          }),
    });
    let value: unknown;
    try {
      value = json(await response.text());
    } catch (cause) {
      throw new Error('The server returned an invalid response.', { cause });
    }
    if (!response.ok) {
      try {
        throw new Error(parseApiError(value).error);
      } catch (error) {
        if (error instanceof Error && error.name !== 'ContractError') throw error;
        throw new Error('The server request failed.', { cause: error });
      }
    }
    return value;
  }
  return {
    async match(input: string, signal?: AbortSignal): Promise<MatchResponse> {
      return parseMatchResponse(await request('/api/match', { input }, signal));
    },
    async status(): Promise<StatusResponse> {
      return parseStatusResponse(await request('/api/status'));
    },
  };
}
