/** What this panel calls itself, and the one place that decides it.
 *
 *  `VITE_APP_NAME` overrides the name at build time. With nothing set, the panel says what it is:
 *  these screens running on the built-in store, not on anybody's company. Every screen prints the
 *  value from here rather than a literal, so re-naming a deployment is one environment variable
 *  and not a search through the components.
 */

const RAW_NAME = ((import.meta.env.VITE_APP_NAME as string | undefined) ?? '').trim();

export const APP_NAME = RAW_NAME || 'Operations Suite';

/** The line under the wordmark in the sidebar and on the sign-in card. */
export const APP_SUBTITLE = 'Enterprise Cockpit';

/** What the sign-in card promises, in the panel's own words. */
export const APP_TAGLINE =
  'Live steel & roofing enterprise operations — sales booking, yard dispatch, dealer ledgers and stock synchronization.';
