# On Deck Scaffold Agent Guide

This app was scaffolded with `remix new`. Use these conventions when continuing to build it out.

## Commands

```sh
npm i
npm run start
npm test
npm run typecheck
```

## Building Features

Refer to ./.agents/skills/remix/SKILL.md

## Layout

- `app/routes.ts` defines the route contract
- `app/router.ts` wires routes to route handlers
- `app/mediaTypes.ts` is the media-type registry — the vocabulary (`ActiveMediaType`,
  `parseMediaType`) plus the per-type table of nouns, copy, status verbs and href
  builders. Lives at the app root because every layer reads it and it depends on
  `routes.ts`.
- `app/actions/` holds controllers and the pages they own
- `app/assets.ts` owns the server-side asset pipeline used by the asset route and renderer
- `app/browser/` is the code that reaches the browser: one module per
  `clientEntry`, plus `app/browser/shared/` for code shared *between client
  entries* and never rendered on the server.
- `app/ui/` holds server-rendered UI shared across route areas: `components/`
  for pieces, `pages/` for whole pages more than one route area renders, and
  `shared/` for the few primitives rendered on **both** sides.

Only `app/ui/shared/` may be imported by a client entry, and it is allowlisted
for exactly that. Keep it free of anything that reaches routes, the media-type
registry or `app/data` — those are what make the rest of `app/ui` unbundlable.
`npm run typecheck` enforces this: after `tsc`, `scripts/check-browser-bundle.ts`
compiles every module under `app/browser` and `app/ui/shared` through the real
asset server, and fails if one of them can no longer be bundled.

Server modules importing a client entry (`nav.tsx` rendering
`<NotificationBell/>`) is normal and expected: that is how one gets placed on a
page. What should not happen is the reverse — a client entry importing server
UI — or server code importing something out of `app/browser/` that is not a
client entry.

The `app/browser` / `app/ui` split is browser-vs-server, not "frontend vs
something else". It is enforced by the `allow` list in `app/assets.ts`, which
gates the whole transitive import graph and fails closed: a client entry that
reaches server code answers `IMPORT_NOT_ALLOWED` rather than bundling it. Widening that
list is what makes a directory reachable from the browser — the directory name
does nothing on its own.
- `app/middleware/` holds request lifecycle concerns
- `app/data/` holds persistence and the services built on it, in subdirectories:
  - `app/data/` root: `db`, `schema`, `mediaItems`, `mediaMetadata`, `users`,
    `follows`, `notifications`, `mediaSummary`
  - `app/data/catalog/` — external metadata providers behind one `CatalogProvider`
    interface (`provider.ts` is the registry; `tmdb`/`openLibrary`/`igdb` implement it).
    `retry.ts` holds the shared GET-with-backoff the two book providers use;
    `circuit.ts` holds the per-provider "stop asking, it's down" rule, which is
    policy each provider opts into rather than something the registry applies
  - `app/data/imports/` — log importers (`csv` is shared plumbing) and `steamApi`.
    A CSV upload is staged rather than written straight to the log: `letterboxd`
    parses, `batches` persists the batch and the decisions review writes onto it,
    `matcher`/`worker` do the catalog lookups in the background, and `resolve`
    settles the whole batch at once so a nearest-year fallback can't take an
    entry an exact match already holds. `classify` and `review` hold the rules —
    confidence, conflicts, duplicates, counts — and are free of the database so
    they can be tested directly
  - `app/data/recommendations/` — the generation pipeline: `picks` asks the model,
    `matching` resolves picks to catalog entries, `exclusions` decides what a run
    may not suggest (database-free, so the rule can be tested directly), `runs`
    persists them, `generate` orchestrates those, `jobs`/`worker` run it in the
    background, `dailyLimit` caps how many runs one account can generate in 24
    hours (`users.is_admin` is exempt — granted only by `scripts/set-admin.ts`),
    and `lucky` holds the once-a-day one-pick draw. A lucky run is an ordinary
    run with `recommendation_runs.is_lucky` set: same queue, same stages, one
    result, a stricter exclusion rule, and its own cap — the run row itself is
    the record that the day's pick has been drawn
- `db/` holds migrations, `public/` static files served from the app root

## Route Ownership

- Start from `app/routes.ts` and map each route to the narrowest owner on disk.
- Put top-level route actions in `app/actions/controller.tsx`.
- Add `app/actions/<route-key>/controller.tsx` for nested route maps that need their own actions or middleware.
- Keep route-owned page modules next to the route that owns them — a page one
  controller renders lives beside it (`app/actions/profile/page.tsx`).
- A page rendered by more than one route area goes in `app/ui/pages/`, not
  `app/actions/`. That is the only thing separating the two locations.

## Build-Out Notes

- Prefer putting code in the narrowest owner before introducing shared modules.
- Avoid generic dumping-ground directories like `app/lib/`, `app/utils/` or
  `app/components/`. Name a directory for what is in it; if you can't, the
  grouping is probably wrong.
- Before adding a per-type lookup table (nouns, labels, verbs), check
  `app/mediaTypes.ts` — it almost certainly already has the field. Three separate
  copies of the plural-noun table had accumulated before they were folded back in.
  Code holding a `MediaType` off a database row wants `mediaTypeUiFor`, since the
  row types widen the column to `string`.
- `media_items` rows are shared by everyone who logged that work, so anything that
  rewrites one changes other people's logs — `rematchMediaItem` repoints the row
  and can merge two of them, which is why the route calling it is admin-only.
  A member correcting a bad match for themselves does it through the import
  review (`repointRow`), which changes which existing row a staged row points at
  and leaves the catalog alone.
- There is no `test/` directory yet, despite `npm test` being wired up.
