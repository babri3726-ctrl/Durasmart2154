/** Which of the four states every screen is meant to be able to show, this build is showing.
 *
 *  Set it in the address bar, once, for the whole tab:
 *
 *    `?demo=success`  (default) — the fixtures answer
 *    `?demo=empty`    — every list comes back with no rows, so the empty states are reachable
 *    `?demo=error`    — every request fails, so each screen's error copy is reachable
 *    `?demo=loading`  — every data request stalls, so the skeletons are reachable; signing in and
 *                       the boot rehydration still answer, or the panel would never get that far
 *
 *  It is deliberately not a fixture in the data: a screen that can only ever show one state has
 *  not been tested in the other three, and this project exists to be looked at.
 */

export type DemoState = 'success' | 'empty' | 'error' | 'loading';

const KEY = 'demo.state';

const VALID: DemoState[] = ['success', 'empty', 'error', 'loading'];

function resolve(): DemoState {
  const fromUrl = new URLSearchParams(window.location.search).get('demo');
  if (fromUrl && VALID.includes(fromUrl as DemoState)) {
    window.sessionStorage.setItem(KEY, fromUrl);
    return fromUrl as DemoState;
  }
  const stored = window.sessionStorage.getItem(KEY);
  return stored && VALID.includes(stored as DemoState) ? (stored as DemoState) : 'success';
}

const state = resolve();

export const demoState = (): DemoState => state;
