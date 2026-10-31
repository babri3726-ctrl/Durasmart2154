/** Provisional sync constants and identity states.
 *
 *  Imported by serverApi, mock routers, and debtors fixtures to enforce that unverified
 *  provisional records maintain strict labeling and cannot masquerade as official debtor ledgers.
 */

export const PROVISIONAL_LABEL = 'PROVISIONAL — NOT VERIFIED TALLY IDENTITIES';
export const PROVISIONAL_IDENTITY_STATE = 'provisional';
export const PROVISIONAL_AS_OF = '2026-04-01';
export const PROVISIONAL_SOURCE_PERIOD = '1-Apr-26 to 31-Oct-26';
export const PROVISIONAL_PERIOD_WARNING =
  `The source workbook's reporting period is ${PROVISIONAL_SOURCE_PERIOD}. ` +
  `${PROVISIONAL_AS_OF} is the owner-selected provisional balance date — the workbook does not ` +
  'independently verify a balance on that day, and no record here is a verified Tally identity.';
