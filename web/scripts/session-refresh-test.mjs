/** Focused tests for what the panel does when the backend refuses its token.
 *
 *  `serverApi.ts` holds the credentials, and a wrong move here is expensive in a way a screenshot
 *  cannot show. Clear a session on the wrong evidence and an owner in the middle of a job is
 *  thrown out to a password prompt by a tunnel that dropped for a second; keep a session on the
 *  wrong evidence and every screen still mounted replays a token the server has already refused,
 *  each replay another 401. And because this server rotates the refresh token on every use and
 *  revokes the whole family when it sees one value twice — `backend/app/services/auth.py:250-272`,
 *  audit entry included — a panel that fires several requests at once on one expired access token
 *  can accuse its own operator of the replay attack it is reporting.
 *
 *  The decisions therefore live in `src/lib/sessionRules.ts`, which imports nothing and is loaded
 *  here the same way `entry-boundary-test.mjs` loads `entryRules.ts`: type stripping, no bundler,
 *  no database. What cannot be decided in pure functions — which branch calls which rule — is
 *  checked against the source text, the way `stock-preview-contract-test.mjs` checks the request
 *  core. Neither half is a substitute for the other, and neither runs the browser: that the
 *  refused token really does land the operator on `/login` is the manual step in the report.
 *
 *  Usage:  npm run test:session
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPIRED_SESSION_MESSAGE,
  canAttemptRequest,
  credentialIsSpent,
  credentialRefused,
} from '../src/lib/sessionRules.ts';

const here = dirname(fileURLToPath(import.meta.url));
const panelRoot = join(here, '..');
const source = (relative) => readFileSync(join(panelRoot, relative), 'utf8');
const client = source('src/lib/serverApi.ts');
const store = source('src/lib/liveSession.ts');

// ── which answer is a refusal of the credential ──────────────────────────

test('only a 401 is read as "this credential is no good"', () => {
  assert.equal(credentialRefused(401), true);
});

test('a 403 is the role, not the sign-in, and must not end the session', () => {
  // `require_owner` (`backend/app/deps.py:89-96`) refuses an employee for a route the owner can
  // see. Treating that as a spent session would log the employee out for opening a page — and the
  // owner-access card that explains the refusal could then never render, because it needs the
  // very session that was just destroyed.
  assert.equal(credentialRefused(403), false);
});

test('a server fault or a rate limit is nobody\'s credential', () => {
  // The lockout added in this branch answers 429 on auth routes; a 500 from any other route means
  // the backend had a problem, not the token. Neither is evidence about a credential.
  for (const status of [200, 400, 409, 423, 429, 500, 503]) {
    assert.equal(credentialRefused(status), false, `${status} read as a credential refusal`);
  }
});

// ── refused versus unreachable ───────────────────────────────────────────

test('a backend that could not be reached says nothing about the token', () => {
  // `send()` stamps `code: 'network'` on a fetch that never arrived and on one that ran out its
  // own budget. In both cases the stored pair may still be perfectly good, so it has to survive.
  assert.equal(credentialIsSpent({ code: 'network', status: 0 }), false);
});

test('an answer about the refresh token spends the session', () => {
  assert.equal(credentialIsSpent({ code: 'invalid_refresh_token', status: 401 }), true);
  // A deactivated login: the backend refuses a rotation with 403 (`services/auth.py:281-282`), and
  // that is a session that cannot be continued by anyone at this keyboard.
  assert.equal(credentialIsSpent({ code: 'forbidden', status: 403 }), true);
});

test('an answer this client cannot read ends the session rather than replaying the refused one', () => {
  // Fail-closed on purpose. The access token has already been refused at this point, so the only
  // question is whether to keep using it; an unparseable rotation response is not a reason to.
  assert.equal(credentialIsSpent(new Error('Unexpected token < in JSON')), true);
  assert.equal(credentialIsSpent(undefined), true);
  assert.equal(credentialIsSpent(null), true);
  assert.equal(credentialIsSpent('network'), true); // a bare string carries no code to trust
});

// ── do not put a spent credential on the wire ────────────────────────────

test('an authenticated call with no stored credential is not sent at all', () => {
  assert.equal(canAttemptRequest({ auth: true, access: null, refresh: null }), false);
});

test('either half of a session is enough to ask the server', () => {
  assert.equal(canAttemptRequest({ auth: true, access: 'a', refresh: 'r' }), true);
  assert.equal(canAttemptRequest({ auth: true, access: 'a', refresh: null }), true);
  // A stored refresh token alone is the one state in which the call can recover the session rather
  // than end it, so it must still go out.
  assert.equal(canAttemptRequest({ auth: true, access: null, refresh: 'r' }), true);
});

test('sign-in, rotation and logout are never blocked by a missing session', () => {
  // These three routes are the way back in. Refusing to send them when no token is stored would
  // make the panel unable to sign in — the guard would have destroyed the thing it guards.
  assert.equal(canAttemptRequest({ auth: false, access: null, refresh: null }), true);
});

// ── the words said to the operator ───────────────────────────────────────

test('the client says what to do, and names no secret', () => {
  assert.match(EXPIRED_SESSION_MESSAGE, /sign in again\./i);
  for (const leak of ['Bearer', 'ds.server', 'token', 'Authorization']) {
    assert.ok(!EXPIRED_SESSION_MESSAGE.includes(leak), `the sentence carries ${leak}`);
  }
});

// ── the wiring: which branch calls which rule ────────────────────────────

/** The 401 block of the request core, from its guard to the next status check. */
const refusalBlock = () => {
  const start = client.indexOf('if (credentialRefused(response.status)');
  assert.notEqual(start, -1, 'the request core does not route 401 through the rule');
  const end = client.indexOf('if (response.status === 204)', start);
  assert.notEqual(end, -1, 'the 401 block does not end where the request core continues');
  return client.slice(start, end);
};

test('a refused credential is cleared and the caller is told to sign in', () => {
  const block = refusalBlock();
  assert.match(block, /await refreshTokens\(\)/);
  assert.match(block, /status === 'rotated'\) return send<T>\(path, \{ \.\.\.options, retried: true \}\)/);
  assert.match(block, /endServerSession\(\);\s*throw new ServerError\(outcome\.message, \{ code: 'unauthenticated', status: 401 \}\)/);
});

test('an unreachable backend does not clear the session', () => {
  const block = refusalBlock();
  const unreachableAt = block.indexOf("status === 'unreachable'");
  const clearAt = block.indexOf('endServerSession()');
  assert.notEqual(unreachableAt, -1, 'the 401 block has no unreachable branch');
  assert.ok(
    clearAt > unreachableAt,
    'the unreachable branch clears the credentials before handing the failure back',
  );
  assert.match(block.slice(unreachableAt, clearAt), /throw outcome\.error;/);
});

test('a second 401 after a rotation ends the session instead of looping', () => {
  // Without the `retried` flag this is a request that answers itself with a refresh, forever.
  const block = refusalBlock();
  assert.match(block, /if \(!retried\) \{/);
  const afterGuard = block.slice(block.indexOf('if (!retried) {'));
  const closed = afterGuard.slice(afterGuard.lastIndexOf('endServerSession();'));
  assert.match(closed, /throw new ServerError\(EXPIRED_SESSION_MESSAGE, \{ code: 'unauthenticated', status: 401 \}\)/);
});

test('a spent session stops further requests at the door', () => {
  assert.match(
    client,
    /if \(!canAttemptRequest\(\{ auth, access: readToken\(ACCESS_KEY\), refresh: readToken\(REFRESH_KEY\) \}\)\)/,
  );
});

test('the rotation is single-flighted, so one expiry is one refresh', () => {
  // Two concurrent 401s posting the same stored refresh value is the replay the server punishes.
  assert.match(client, /let refreshInFlight: Promise<RefreshOutcome> \| null = null;/);
  assert.match(client, /const running = refreshInFlight;\s*if \(running\) return running;/);
  assert.match(client, /if \(refreshInFlight === attempt\) refreshInFlight = null;/);
});

test('clearing the session removes both stored copies by key', () => {
  assert.match(client, /function endServerSession\(\): void \{\s*clearServerSession\(\);/);
  assert.match(client, /export function clearServerSession\(\): void \{\s*writeTokens\(null, null\);/);
  // No token value is passed to it: the only arguments are the two nulls that mean "remove".
  assert.match(client, /writeTokens\(null, null\)/);
});

test('the app moves to the sign-in state it already had', () => {
  // `user` is what `RequireAuth` reads, so this one call is the whole transition — and it is what
  // leaves no screen mounted to replay the refused token.
  assert.match(store, /setSessionRefusedHandler\(\(\) => \{/);
  assert.match(store, /setUser\(null\);/);
  assert.match(source('src/App.tsx'), /if \(!user\) return <Navigate to="\/login"/);
});

test('the operator is told the session ended, because the redirect unmounts the screen that knew', () => {
  assert.match(store, /if \(user !== null\) toast\.error\(EXPIRED_SESSION_MESSAGE\);/);
});

// ── nothing prints a credential ──────────────────────────────────────────

test('no client file logs, and the stored value is interpolated exactly once', () => {
  for (const file of [
    'src/lib/serverApi.ts',
    'src/lib/sessionRules.ts',
    'src/lib/liveSession.ts',
    'src/App.tsx',
    'src/pages/Login.tsx',
  ]) {
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(source(file)), `${file} logs`);
  }
  // The Authorization header is the credential's one and only appearance in a template string.
  // Anything else that interpolates it is a message, and a message can be read over a shoulder,
  // pasted into a screenshot or sent to a log shipper.
  const interpolations = [...client.matchAll(/\$\{(access|refresh|refreshToken|accessToken)\}/g)].map((m) => m[0]);
  assert.deepEqual(interpolations, ['${access}']);
  assert.match(client, /if \(access\) headers\.Authorization = `Bearer \$\{access\}`;/);
});
