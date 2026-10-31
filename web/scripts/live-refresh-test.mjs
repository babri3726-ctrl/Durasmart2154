/** Focused tests for what the panel says about how current its numbers are.
 *
 *  A screen here has no cache: it asks the backend when it mounts, so the only way it can be out of
 *  date is that it has been left open. That makes the failure mode a talking problem, not a loading
 *  problem — a table whose refresh failed is still on screen, still looks like data, and is being
 *  offered to the owner as if it had just arrived. If the answer to "is this current?" is decided
 *  inside JSX it gets decided nine times, slightly differently, and one of those nine will say
 *  "updated" about a read that failed.
 *
 *  So the decision lives in `src/lib/liveSync.ts`, which imports nothing and is loaded here the way
 *  `session-refresh-test.mjs` loads `sessionRules.ts`: type stripping, no bundler, no database, no
 *  browser. What cannot be decided in a pure function — that the hooks actually keep the rows on a
 *  failed refresh, dedupe a second tap, and never stamp a failure as a successful read — is checked
 *  against the source text, and that the operator really sees "Refresh failed" on a screen is the
 *  manual step in the report.
 *
 *  Usage:  npm run test:refresh
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSyncTime, syncNotice, syncSentence } from '../src/lib/liveSync.ts';
import { invalidate, syncKeys, useSyncStore } from '../src/lib/syncStore.ts';

const here = dirname(fileURLToPath(import.meta.url));
const panelRoot = join(here, '..');
const source = (relative) => readFileSync(join(panelRoot, relative), 'utf8');

const listHook = source('src/lib/useLiveList.ts');
const resourceHook = source('src/lib/useResource.ts');
const bar = source('src/components/ui/LiveSync.tsx');

/** The sync state a screen would hold: a refresh has been tapped and the server refused it, while the
 *  rows from 12:00:04 stay on screen. */
const stale = { refresh: () => {}, isRefreshing: false, syncedAt: new Date(2026, 9, 16, 12, 0, 4).getTime(), refreshError: 'No route to host' };

// ── what may be claimed ──────────────────────────────────────────────────

test('a refresh in flight is reported as a refresh, whatever arrived before it', () => {
  // Even a failed last attempt: the operator has asked again and the answer is on its way, so the
  // stale warning would be describing a request that is no longer the current one.
  assert.equal(syncNotice({ ...stale, isRefreshing: true }), 'syncing');
  assert.equal(syncNotice({ ...stale, refreshError: '', isRefreshing: true }), 'syncing');
});

test('nothing has arrived is never called fresh', () => {
  assert.equal(syncNotice({ refresh: () => {}, isRefreshing: false, syncedAt: null, refreshError: '' }), 'never');
  // The state a screen is in when its very first load failed. `syncedAt` is the only thing that
  // distinguishes "the server says there are no rows" from "we never got an answer", and the empty
  // list and the error look identical without it.
  assert.equal(syncNotice({ refresh: () => {}, isRefreshing: false, syncedAt: null, refreshError: 'gone' }), 'never');
});

test('rows that arrived and refreshed are fresh', () => {
  assert.equal(syncNotice({ ...stale, refreshError: '' }), 'fresh');
});

test('rows that arrived while a later refresh failed are stale, not fresh and not an error', () => {
  assert.equal(syncNotice(stale), 'stale');
});

// ── the sentence said under the table ────────────────────────────────────

test('the fresh sentence gives the moment the rows arrived, in local 24-hour time', () => {
  const fresh = syncSentence({ ...stale, refreshError: '' }, '12:00:04');
  assert.match(fresh, /Read from the server at 12:00:04\./);
  assert.ok(!/fail/i.test(fresh), 'a successful read mentions a failure');
});

test('the stale sentence keeps the rows, names the time they arrived and quotes the failure', () => {
  const sentence = syncSentence(stale, '12:00:04');
  assert.match(sentence, /Refresh failed at 12:00:04/);
  assert.match(sentence, /last figures that arrived/);
  assert.match(sentence, /No route to host/);
  // The claim this whole file exists to prevent: presenting retained rows as current.
  assert.ok(!/up to date|current/i.test(sentence), 'a failed refresh claims currency');
});

test('the syncing sentence does not promise an answer', () => {
  assert.match(syncSentence({ ...stale, isRefreshing: true }, '12:00:04'), /Asking the server again/);
});

test('the empty sentence says no answer has arrived rather than that there is nothing to show', () => {
  assert.match(syncSentence({ refresh: () => {}, isRefreshing: false, syncedAt: null, refreshError: '' }, ''), /Nothing has arrived/);
});

test('the time is written by hand, so it does not depend on the browser locale', () => {
  // One office, many machines; `toLocaleTimeString` would add an am/pm on some of them and change
  // the separators on others, and a stamp that moves around is not a stamp.
  assert.equal(formatSyncTime(new Date(2026, 9, 16, 4, 5, 6).getTime()), '04:05:06');
  assert.equal(formatSyncTime(new Date(2026, 9, 16, 23, 59, 59).getTime()), '23:59:59');
});

// ── the hooks: what a refresh actually does ──────────────────────────────

/** The refresh callback of a hook, from its guard to the end of its `finally`. */
const refreshBody = (text) => {
  const start = text.indexOf('const refresh = useCallback(');
  assert.notEqual(start, -1, 'the hook has no refresh callback');
  const end = text.indexOf('}, [', start);
  assert.notEqual(end, -1, 'the refresh callback does not end in a dependency list');
  return text.slice(start, end);
};

for (const [name, text] of [
  ['useLiveList', listHook],
  ['useResource', resourceHook],
]) {
  test(`${name}: a second tap while one refresh is running is dropped, not queued`, () => {
    assert.match(text, /if \(refreshInFlight\.current\) return;/);
    assert.match(text, /refreshInFlight\.current = true;/);
    // Cleared in `finally`, so a failure cannot leave the button disabled for the rest of the visit.
    const body = refreshBody(text);
    assert.match(body, /\.finally\(\(\) => \{\s*refreshInFlight\.current = false;\s*setIsRefreshing\(false\);/);
  });

  test(`${name}: only a response that arrived can stamp or replace the rows`, () => {
    const body = refreshBody(text);
    const catchBlock = body.slice(body.indexOf('.catch('), body.indexOf('.finally('));
    for (const forbidden of ['setSyncedAt', 'setRefreshError(\'\'']) {
      assert.ok(!catchBlock.includes(forbidden), `the failure path touches ${forbidden}`);
    }
    assert.match(body, /setSyncedAt\(Date\.now\(\)\)/);
    // The last successful read of the whole screen, from either path — an effect that re-ran and
    // stamped it, or a refresh that landed.
    assert.equal(text.match(/setSyncedAt\(Date\.now\(\)\)/g).length, 2, 'both paths must stamp');
  });

  test(`${name}: a failed refresh over arrived rows reports itself and keeps what is on screen`, () => {
    const body = refreshBody(text);
    assert.match(body, /setRefreshError\(message\)/);
    if (name === 'useLiveList') assert.ok(!body.includes('setRows([])'), 'the failure clears the table');
    if (name === 'useResource') assert.ok(!/setData\(null\)/.test(body.slice(body.indexOf('.catch('))), 'the failure drops the row');
    // Nothing has ever arrived, so this is a load that failed and the screen's own error branch has
    // to carry it — otherwise the operator sees "nothing has arrived" next to stale figures that
    // do not exist.
    assert.match(body, /if \(syncedAt === null\) \{/);
  });

  test(`${name}: a refresh cannot take the sequence away from the load in flight`, () => {
    // The effect advances the counter and both paths drop an answer that has been overtaken. If the
    // refresh advanced it too, the loading response would be discarded and the screen would sit on
    // "Loading…" for the rest of the visit.
    assert.equal(text.match(/\+\+sequence\.current/g).length, 1, 'only the effect may advance it');
    assert.match(refreshBody(text), /const mine = sequence\.current;/);
    assert.match(text, /if \(mine !== sequence\.current\) return;/);
  });

  test(`${name}: refreshing re-reads; it does not write`, () => {
    // §4 of the brief: a refresh must not create a business record or repeat a write. The refresh
    // path issues the same request the screen issued on entry and nothing else.
    const body = refreshBody(text);
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'Idempotency']) {
      assert.ok(!body.includes(method), `the refresh path mentions ${method}`);
    }
  });
}

// ── every live screen carries the control ────────────────────────────────

const liveScreens = [
  'src/pages/Customers.tsx',
  'src/pages/Orders.tsx',
  'src/pages/Dispatch.tsx',
  'src/pages/DispatchNew.tsx',
  'src/pages/DispatchHistory.tsx',
  'src/pages/Payment.tsx',
  'src/pages/Stock.tsx',
  'src/pages/Employees.tsx',
  'src/pages/CustomerDetail.tsx',
  'src/pages/OrderDetail.tsx',
  'src/pages/EmployeeDetail.tsx',
];

for (const file of liveScreens) {
  test(`${file}: every read it makes carries a sync line`, () => {
    const text = source(file);
    const reads = (text.match(/useLiveList\(/g) ?? []).length + (text.match(/useResource\(/g) ?? []).length;
    assert.ok(reads > 0, 'the screen is in the list but reads nothing');
    // At least one sync binding handed down per read. A detail screen has one bar per request,
    // because one shared notice could only ever be true of one of them and the reader would take it
    // for the other; Stock's three tabs share a `ListStates` wrapper, so its count is higher than
    // its reads rather than lower. A read with no bar anywhere is the case this catches.
    const bars = (text.match(/sync=\{[A-Za-z]+(?:\.sync)?\}/g) ?? []).length;
    assert.ok(bars >= reads, `${reads} read(s) but only ${bars} sync binding(s)`);
    assert.match(text, /from '\.\.\/components\/ui\/LiveSync'/);
  });
}

test('the bar itself cannot be tapped into a second request while one is running', () => {
  assert.match(bar, /disabled=\{busy \|\| sync\.isRefreshing\}/);
  // A failed refresh is the one state that must be loud: the rows below it look exactly like the
  // rows that would have arrived.
  assert.match(bar, /notice === 'stale' \? 'font-semibold text-brand-red'/);
});

test('the panel renders the wording from the rules file, not its own copy', () => {
  assert.match(bar, /\{syncSentence\(sync, time\)\}/);
});

// ── P7: one invalidation map, consumed by every affected read ────────────

test('the invalidation keys are the five resources the plan names, spelled once', () => {
  assert.equal(syncKeys.order('ORD-1'), 'orders:ORD-1');
  assert.equal(syncKeys.orderList(), 'orderList:');
  assert.equal(syncKeys.orderList('status=pending'), 'orderList:status=pending');
  assert.equal(syncKeys.dispatch('ORD-1'), 'dispatches:ORD-1');
  assert.equal(syncKeys.dispatchRegister, 'dispatches:');
  assert.equal(syncKeys.debtors, 'debtors');
  assert.equal(syncKeys.target('EMP-1'), 'targets:EMP-1');
  assert.equal(syncKeys.targetBook, 'targets:');
});

test('a bump moves every named key and no other read', () => {
  const before = { ...useSyncStore.getState().revisions };
  invalidate(syncKeys.order('ORD-7'), syncKeys.orderList(), syncKeys.dispatchRegister);
  const after = useSyncStore.getState().revisions;

  for (const key of ['orders:ORD-7', 'orderList:', 'dispatches:']) {
    assert.equal(after[key], (before[key] ?? 0) + 1, `${key} did not move exactly once`);
  }
  assert.equal(after['targets:EMP-1'], before['targets:EMP-1'], 'an unrelated key moved');
});

test('useResource gained the token and re-reads through refresh, not a fresh load', () => {
  assert.match(resourceHook, /fetcher: \(\) => Promise<T>,\s*refreshToken = 0,/);
  assert.match(resourceHook, /const tokenSeen = useRef\(refreshToken\);/);
  const effect = resourceHook.slice(resourceHook.indexOf('if (tokenSeen.current === refreshToken) return;'));
  assert.match(effect, /tokenSeen\.current = refreshToken;\s*refresh\(\);/);
  // The token must not sit in the initial-load effect: that path clears the row on failure and
  // would turn a successful write followed by a blip into a blank screen.
  assert.ok(!/\[fetcher, retryCount, refreshToken\]/.test(resourceHook));
});

test('the panel write paths bump the keys their figures live under', () => {
  assert.match(source('src/components/Consignments.tsx'), /onChanged\(row\.orderId\)/);
  assert.match(source('src/pages/DispatchNew.tsx'), /invalidate\(syncKeys\.dispatch\(bal\.orderId\), syncKeys\.order\(bal\.orderId\), syncKeys\.orderList\(\)\)/);
  assert.match(source('src/pages/OrderDetail.tsx'), /invalidate\(syncKeys\.order\(o\.id\), syncKeys\.orderList\(\)\)/);
  assert.match(source('src/pages/OrderNew.tsx'), /invalidate\(syncKeys\.order\(created\.id\), syncKeys\.orderList\(\)\)/);
  assert.match(source('src/pages/Sales.tsx'), /invalidate\(syncKeys\.target\(saved\.employeeId\)\)/);
});

test('the reads those writes stale consume the same keys', () => {
  assert.match(source('src/pages/Orders.tsx'), /useSyncPrefix\(syncKeys\.orderList\(''\)\)/);
  assert.match(source('src/pages/DispatchHistory.tsx'), /useSyncPrefix\(syncKeys\.dispatchRegister\)/);
  assert.match(source('src/pages/OrderDetail.tsx'), /useSyncToken\(syncKeys\.order\(id\)\)/);
  assert.match(source('src/pages/OrderDetail.tsx'), /useSyncToken\(syncKeys\.dispatch\(id\)\)/);
  assert.match(source('src/pages/Sales.tsx'), /useSyncPrefix\(syncKeys\.targetBook\)/);
});

test('nothing here logs, and no credential is in any of it', () => {
  for (const file of ['src/lib/liveSync.ts', 'src/lib/useLiveList.ts', 'src/lib/useResource.ts', ...liveScreens]) {
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(source(file)), `${file} logs`);
  }
  for (const file of ['src/lib/liveSync.ts', 'src/components/ui/LiveSync.tsx']) {
    const text = source(file);
    for (const leak of ['Authorization', 'Bearer', 'ds.server', 'refreshToken']) {
      assert.ok(!text.includes(leak), `${file} mentions ${leak}`);
    }
  }
});
