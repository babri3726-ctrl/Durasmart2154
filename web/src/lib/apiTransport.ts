/** The panel's only network seam.
 *
 *  Every request the UI makes goes through here, and here it splits in two:
 *
 *  * `VITE_API_BASE_URL` set — the request is a plain `fetch` against that origin plus `/api/v1`.
 *    This is how a real backend gets connected later without touching a single screen.
 *  * unset (the default for this project) — the request is answered in the browser by
 *    `mock/router.ts` from a deterministic in-memory store. No socket is opened, so there is no
 *    server, no database and no credential anywhere in a default build.
 *
 *  `send()` in `serverApi.ts` is the only caller, which is why swapping the data source never
 *  reaches the components.
 */

import { mockRequest } from './mock/router';

const RAW_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').trim();

export const API_BASE_URL = RAW_BASE.replace(/\/+$/, '');

/** True only when this build was pointed at a backend of its own. */
export const realBackendConfigured = (): boolean => API_BASE_URL !== '';

/** What `serverHost()` shows when there is no backend: the name the built-in store answers to. */
export const DATA_SOURCE_LABEL = 'demo.local';

export function transportFetch(path: string, init: RequestInit): Promise<Response> {
  if (realBackendConfigured()) return fetch(`${API_BASE_URL}/api/v1${path}`, init);
  return mockRequest(path, init);
}
