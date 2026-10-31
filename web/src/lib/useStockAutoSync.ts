/** The bounded "automatic stock update" the panel offers: re-run the current authenticated read
 *  on a timer, never write anything.
 *
 *  The interval choices are the whole bound — there is no server push and no polling faster than
 *  30 seconds. The preference is remembered in this browser only, under the key the Approved stock
 *  tab already used, so turning it on there and opening the dashboard keeps the same setting.
 */

import { useEffect, useRef, useState } from 'react';

export const STOCK_AUTO_SYNC_KEY = 'ds.stock.autoSyncSeconds';
export const AUTO_SYNC_CHOICES = [0, 30, 60, 300] as const;

export const AUTO_SYNC_LABEL: Record<number, string> = {
  0: 'Off — refresh by hand',
  30: 'Re-read every 30 seconds',
  60: 'Re-read every minute',
  300: 'Re-read every 5 minutes',
};

export function autoSyncSentence(seconds: number): string {
  if (seconds === 0) return 'Automatic re-read is off; the refresh button still re-reads on demand.';
  if (seconds < 60) return `While this screen is open it is re-read every ${seconds} seconds. The read writes nothing.`;
  if (seconds === 60) return 'While this screen is open it is re-read every minute. The read writes nothing.';
  return 'While this screen is open it is re-read every five minutes. The read writes nothing.';
}

const readStoredSeconds = (): number => {
  try {
    const stored = Number(window.localStorage.getItem(STOCK_AUTO_SYNC_KEY));
    return (AUTO_SYNC_CHOICES as readonly number[]).includes(stored) ? stored : 0;
  } catch {
    return 0;
  }
};

export function useStockAutoSync(refresh: () => void): {
  seconds: number;
  choose: (seconds: number) => void;
} {
  const [seconds, setSeconds] = useState<number>(readStoredSeconds);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (seconds === 0) return;
    const timer = window.setInterval(() => refreshRef.current(), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

  const choose = (next: number) => {
    setSeconds(next);
    try {
      window.localStorage.setItem(STOCK_AUTO_SYNC_KEY, String(next));
    } catch {
      // A browser that refuses storage still gets the timer for this visit; the preference simply
      // will not be remembered. That is not a reason to turn the read off.
    }
    if (next !== 0) refreshRef.current();
  };

  return { seconds, choose };
}
