/** The one kind of signed-in this panel has: a session the data source re-checks.
 *
 *  A session is either the answer to `GET /me` or there is none — there is no second, unauthenticated
 *  way into these screens. In a default build the data source is the built-in store behind
 *  `apiTransport.ts`, so signing in here never leaves the browser; `user` is null until it answers,
 *  which is why screens that write check it before offering the button, and `checked` stops
 *  `RequireAuth` flashing the login page while the boot rehydration in `App.tsx` is still in flight.
 */

import { create } from 'zustand';
import { EXPIRED_SESSION_MESSAGE } from './sessionRules';
import { toast } from './toast';
import { rehydrate, setSessionRefusedHandler, signOut, type ServerUser } from './serverApi';

interface LiveSessionState {
  /** The `/me` answer for the stored token; null when there is no live session. */
  user: ServerUser | null;
  /** False until the boot rehydration has run once, so RequireAuth does not flash the login. */
  checked: boolean;
  setUser: (user: ServerUser | null) => void;
  setChecked: (checked: boolean) => void;
}

export const useLiveSession = create<LiveSessionState>((set) => ({
  user: null,
  checked: false,
  setUser: (user) => set({ user }),
  setChecked: (checked) => set({ checked }),
}));

/** What happens when the backend refuses this tab's credential outright.
 *
 *  The stored tokens are already gone by the time this runs — `endServerSession()` in
 *  `serverApi.ts` clears them before calling out — so the only half a client cannot do alone is the
 *  app's own state: `user` is exactly what `RequireAuth` reads, so clearing it is the whole
 *  transition to sign-in, and it is what leaves no screen mounted to replay the refused token.
 *
 *  The reason is said out loud because that transition unmounts the screen which would otherwise
 *  have shown it. An operator dropped onto a blank sign-in form cannot tell a spent session from a
 *  broken panel, and the two need different answers from them.
 */
setSessionRefusedHandler(() => {
  const { user, setUser } = useLiveSession.getState();
  setUser(null);
  if (user !== null) toast.error(EXPIRED_SESSION_MESSAGE);
});

/** Runs once at boot: asks the server what the stored token is worth, if any. */
export async function startLiveSession(): Promise<void> {
  const store = useLiveSession.getState();
  try {
    const user = await rehydrate();
    store.setUser(user);
  } catch {
    // rehydrate only throws for answers it does not understand; treat them as "no session".
    store.setUser(null);
  } finally {
    store.setChecked(true);
  }
}

/** Ends the server session: best-effort logout, tokens cleared, store updated. */
export async function endLiveSession(): Promise<void> {
  await signOut();
  useLiveSession.getState().setUser(null);
}
