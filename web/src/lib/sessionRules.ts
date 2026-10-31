/** The session rules, kept apart from the client so they can be tested without a browser.
 *
 *  These three decisions are what stands between a stalled network and a logged-out owner. The
 *  panel stores its tokens in this tab's `sessionStorage` and every live screen sends them, so
 *  getting the distinction wrong fails in one of two bad directions: clear the credentials too
 *  readily and a tunnel dropping for a second throws the operator out of the middle of a job and
 *  asks for a password; clear them too reluctantly and a token the server has already refused
 *  keeps being replayed by every screen still mounted, each replay answering 401.
 *
 *  The server's own behaviour is what these rules are read against. `POST /auth/refresh` answers
 *  401 `invalid_refresh_token` for an unknown, already-rotated or expired token
 *  (`backend/app/services/auth.py:244-279`) — and an already-rotated presentation is treated as a
 *  replay that revokes the whole family (`:250-272`), so two requests that each independently
 *  refresh with the same stored value do not merely duplicate work: the second is the replay.
 *  Separately, a 403 on an ordinary route is the *role* being refused (`deps.py:89-96`), not the
 *  credential, and must leave the session alone.
 *
 *  No imports, so `node --test scripts/session-refresh-test.mjs` can load this file directly with
 *  type stripping. `serverApi.ts` is the bundled side of the split.
 */

/** The one sentence this client uses when it has ended a session itself, matching the backend's
 *  own `EXPIRED_SESSION` wording (`services/auth.py:50`). */
export const EXPIRED_SESSION_MESSAGE = 'Your session has ended. Sign in again.';

/** True for the statuses that say *this credential is not good*, as opposed to this credential is
 *  not allowed to see that.
 *
 *  Only 401 qualifies. A 403 is the role failing `require_owner` while the sign-in behind it is
 *  still perfectly valid, and treating it as a spent session would log an employee out for opening
 *  a company financials page — and then the panel's owner-access card could never be reached,
 *  because the screens that render it need the session that was just destroyed. */
export function credentialRefused(status: number): boolean {
  return status === 401;
}

/** Whether a failed rotation leaves the tab with a usable credential.
 *
 *  `code === 'network'` is what `send()` raises for a fetch that never arrived, and for one that
 *  ran out its own time budget (`serverApi.ts`, the `code: 'network'` branch). Neither says
 *  anything about the token, so the stored pair stays put and the next screen entry can retry.
 *  Every other outcome — a 401 refusal, a 403 for a deactivated login
 *  (`backend/app/services/auth.py:281-282`), an answer this client could not parse — leaves the
 *  caller unable to obtain a working token, and the honest side of that is to end the session
 *  rather than keep replaying the refused one. Fail closed, but only on an answer. */
export function credentialIsSpent(cause: unknown): boolean {
  const code =
    typeof cause === 'object' && cause !== null
      ? (cause as { code?: unknown }).code
      : undefined;
  return code !== 'network';
}

/** Whether a call is worth putting on the wire at all.
 *
 *  Once the credentials are cleared there is nothing to authenticate with, and an unauthenticated
 *  request to a protected route is a round trip that can only return the 401 that started this.
 *  A stored refresh token alone still counts as worth sending: that is the one state in which the
 *  call can recover the session rather than end it. */
export function canAttemptRequest(params: {
  readonly auth: boolean;
  readonly access: string | null;
  readonly refresh: string | null;
}): boolean {
  if (!params.auth) return true;
  return params.access !== null || params.refresh !== null;
}
