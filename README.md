# On Deck

A media log and recommendation app. You keep a log across four media types —
movies, TV, books and games — rate and annotate what you've finished, follow
other people, and read an activity feed of what they've logged.

On top of that log it generates recommendations: a shortlist built from your
taste profile (optionally pooled with friends' for a group pick), and a
once-a-day "lucky" draw of a single title. Generation runs as a queued
background job, so the page reports real stages rather than blocking.

Existing libraries can be imported rather than re-entered: a Letterboxd export
(.zip), a Goodreads CSV, or a linked Steam account. Imports are staged — rows
are matched against the catalogs in the background, then you review the
uncertain matches, conflicts and duplicates before anything is written to your
log.

Metadata comes from TMDB (movies, TV), Google Books with an Open Library
fallback (books), and IGDB (games); recommendations and taste-profile summaries
come from the Anthropic API.

## Requirements

Node >= 24.3.0, and Docker for the local Postgres in `docker-compose.yml`.

## Setup

```sh
npm i
cp .env.example .env    # then fill it in — see below
npm run db:up           # starts Postgres in Docker
npm run db:migrate      # applies pending migrations
npm run dev
```

`.env.example` is the record of which variables the app needs, with a comment
on each explaining what it is and where to get it. `DATABASE_URL` and
`SESSION_SECRET` are needed to boot; the provider keys are needed per feature —
without `TMDB_API_KEY` you can't search movies or TV, without
`ANTHROPIC_API_KEY` you can't generate recommendations, and so on.

Point `DATABASE_URL` at the local container, not the hosted database: every
process runs a worker that claims recommendation jobs from the queue, so a
local server pointed at production will execute real users' jobs.

## Commands

```sh
npm run dev             # watch mode
npm start               # serve (does not migrate — see Deployment)
npm test
npm run typecheck       # tsc, then the browser-bundle check
npm run format          # oxfmt, writes in place
npm run format:check    # oxfmt, reports instead of writing
npm run db:up           # start local Postgres
npm run db:down
npm run db:migrate
npm run db:migrate:down
npm run prod:query      # read-only SELECT against production
```

`npm test` runs the suite under `test/`. Database-backed tests skip themselves
unless `DATABASE_URL` is set, so the suite is runnable with no Postgres — it
just covers less: 254 tests rather than 322. Run `npm run db:up && npm run
db:migrate` first to include them. CI always does.

`npm run typecheck` is two checks: `tsc`, then `scripts/check-browser-bundle.ts`,
which compiles every client entry through the real asset server and fails if one
has picked up an import that can't reach the browser.

## Formatting

`oxfmt` owns code style — `npm run format` writes, `format:check` reports, and
`.oxfmtrc.json` is the whole configuration. CI runs `format:check`, so a branch
that skipped `npm run format` fails before it can merge.

`ignorePatterns` is the part that isn't self-explanatory. Each entry is there
because oxfmt does something wrong to that file:

- `**/*.md` — rewrites fenced code blocks, including in the `.agents/` Remix
  references this repo only vendors
- `public/vendor/**` — third-party CSS and SVG, kept as shipped
- `package.json`, `package-lock.json` — reorders top-level keys; npm owns these
- `fly.toml` — strips the indentation `fly launch` writes

`.git-blame-ignore-revs` lists the commit that reformatted the tree, so those
94 files don't answer for lines it only rewrapped:

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Layout

`AGENTS.md` holds the full contract — which directory owns what, and why the
boundaries sit where they do. In brief:

- `app/routes.ts` defines the routes; `app/router.ts` wires them to controllers
- `app/actions/` holds controllers and the pages they own
- `app/mediaTypes.ts` is the media-type registry: the per-type nouns, copy,
  status verbs and href builders that keep the four types consistent
- `app/data/` holds persistence and the services on it — `catalog/` for the
  metadata providers, `imports/` for the staged importers, `recommendations/`
  for the generation pipeline
- `app/browser/` is code that reaches the browser; `app/ui/` is server-rendered
  UI. The split is enforced by the bundle check above, not by convention
- `db/` holds migrations, `public/` static files served from the app root

## Deployment (Fly.io)

The app is a plain long-running Node server (`server.ts`) with no build
step — it runs TypeScript directly at runtime via `remix/node-tsx` — so the
`Dockerfile` just installs production dependencies and runs `npm start`.

Migrations are a deploy step, not a boot step: `release_command` in `fly.toml`
runs `npm run db:migrate` once per deploy. Booting deliberately doesn't migrate
— the app runs on more than one machine, so migrating from there meant every
machine racing to apply the same migration on every boot.

Pushing to `main` deploys: `.github/workflows/ci.yml` runs `flyctl deploy`
once its `verify` job passes. The two share a file because `needs:` cannot
reach across workflows — a deploy that did not wait for its own checks would
not be a gate.

`verify` is also the name to require in branch protection, and the rule matches
on that string: rename the job and the rule stops applying, silently.

First-time setup:

```sh
fly auth login
fly launch --no-deploy   # rename the app in fly.toml first if "on-deck" is taken
# DATABASE_URL is the same Postgres (Supabase) instance used locally.
fly secrets set \
  SESSION_SECRET=... \
  DATABASE_URL=... \
  TMDB_API_KEY=... \
  ANTHROPIC_API_KEY=... \
  GOOGLE_BOOKS_API_KEY=... \
  STEAM_API_KEY=... \
  TWITCH_CLIENT_ID=... \
  TWITCH_CLIENT_SECRET=...
fly deploy
```

Subsequent deploys are just `fly deploy`. The database is external
(Supabase) and isn't managed by Fly — nothing to provision there.
