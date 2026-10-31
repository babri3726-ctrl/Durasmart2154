# Demo Operations Panel — web

The owner panel's screens, running on their own. Every screen here is the real interface — the
same layouts, navigation, tables, forms, dialogs and states — but the data underneath it is a
store built into the browser. There is no backend, no database and no credential anywhere in a
default build, and nothing a visitor does here leaves the tab.

The interface was reused from the Dura Smart owner panel rather than redrawn; see
[Provenance](#provenance) for what that means and what was deliberately left behind.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Sign in with either demo login — the sign-in card prints them too:

| Identifier | Password | Reaches |
|---|---|---|
| `owner@example.test` | `demo` | Owner — every screen, including the writes |
| `sales@example.test` | `demo` | Salesperson — the day-to-day screens; owner-only routes are refused |

Both `owner` / `sales` short forms work as identifiers. The store is per tab: reload and the rows
this session created are gone, the seeded book comes back.

## The four states

Every screen is meant to be able to show loading, success, empty and error, so all four are
reachable from the address bar. Set it once for the tab:

```
http://localhost:5173/?demo=success     (default) the demo book answers
http://localhost:5173/?demo=empty       every list comes back with no rows
http://localhost:5173/?demo=error       every request fails, so each screen's error copy shows
http://localhost:5173/?demo=loading     every request stalls, so the skeletons show
```

`?demo=error` fails sign-in as well — that is the point: the login form's own error state is one
of the states on show.

## Configuration

Both knobs are optional; the defaults above are the shipped behaviour. Copy `.env.example` to
`.env` to set them.

| Variable | Effect |
|---|---|
| `VITE_APP_NAME` | The name in the sidebar, on the sign-in card and in the browser tab. Default `Demo Operations Panel`. |
| `VITE_API_BASE_URL` | A backend to talk to instead of the built-in store. Unset means the mock answers. |

## How the data layer is split

`src/lib/serverApi.ts` is the panel's only request-shaping module — about eighty functions the
screens call, each one a route's typed wrapper. It makes exactly one network decision, in `send()`,
and that decision now goes through `src/lib/apiTransport.ts`:

```
component → serverApi.ts → apiTransport.ts ─┬─ VITE_API_BASE_URL set → fetch()
                                             └─ unset                → mock/router.ts → mock/store.ts
```

- `src/lib/mock/router.ts` — the routes, matched the way the backend matches them, answering with
  the same status codes and the same `{error: {code, message, fields}}` envelope.
- `src/lib/mock/store.ts` — the mutable in-memory book: what a write changes, and what the reads
  then report.
- `src/lib/mock/fixtures/` — the seeded demo data: parties, orders, dispatches, payments, stock,
  employees, tasks. Every name, number and address in it is invented.

Because the seam is one function, connecting a different backend later is an environment variable,
not a rewrite of the screens. The mock speaks the panel's existing wire conventions exactly —
money in integer paise, quantities as three-decimal strings, ids as `YYYY-MM-DD`, timestamps with
`+05:30` — which is what lets the same payload guards (`readStockPreviewPayload` and friends) run
over both sources.

## Provenance

The components, styles, screens and their tests were copied from the Dura Smart owner panel
(`owner-panel/`) with that project treated as read-only. What was changed:

- the transport seam above, and the mock layer behind it;
- the name, the icon path and the copy that claimed real company records;
- the sign-in footnote, which now says which data source it is signing in against.

What was **not** copied, on purpose: nothing here reads a `.env`, a database URL, a tunnel host, a
certificate or a signing key, and no backend source, migration or data file came along. The
`tunnel`/`allowedHosts` entry that pointed the dev preview at one specific machine is gone.

One string still reads `durasmart`: the reference-namespace value in the debtors screens
(`tally` / `durasmart` / none). It is wire vocabulary that a real backend must agree with, not
branding, so it stays.

The app mark in `public/app-icon.png` is the source project's artwork. Replace it to re-brand;
`VITE_APP_NAME` does not cover the image.

## Checks

```bash
npm run typecheck
npm run lint
npm test          # ten node --test suites, no browser and no backend
npm run build
```

`npm test` covers the form-to-request rules, the session-refresh rules, the refresh/staleness
wording, the reporting window, and the payload-contract suites. The contract suites read
`scripts/stock-*-schema.json` — golden bodies captured from the backend's own models — and assert
the panel parses and words them correctly. They are still useful here: they are what keeps the mock
layer honest about the shape it pretends to answer with.

The panel's original live smoke test (`smoke-test.mjs`) is not part of this project. It drives a
running backend with real credentials, which is precisely what this build must not need.
