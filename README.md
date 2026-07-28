# On Deck Scaffold

A minimal Remix application starter with a home page.

## Starter Shape

- `app/actions/controller.tsx` owns the top-level route actions.
- `app/routes.ts` defines the route contract.
- `app/router.ts` wires routes to handlers.
- `app/middleware/render.tsx` installs the request-scoped renderer used by actions.
- `app/ui/` holds the shared document shell and home page UI.
- `app/assets.ts` owns the server-side asset pipeline used by the asset route and renderer.
- `public/` contains static files served from the app root.

## Growing The App

- Put top-level route actions in `app/actions/controller.tsx`.
- Add `app/actions/<route-key>/controller.tsx` when a nested route map needs its own actions or middleware.
- Add directories like `app/data/` or `test/` when the app actually needs them.
- Move shared UI into `app/ui/` once more than one route needs it.

## Commands

```sh
npm i
npm run start
npm test
npm run typecheck
```

## Deployment (Fly.io)

The app is a plain long-running Node server (`server.ts`) with no build
step — it runs TypeScript directly at runtime via `remix/node-tsx` — so the
`Dockerfile` just installs production dependencies and runs `npm start`,
which applies pending DB migrations then starts the server.

First-time setup:

```sh
fly auth login
fly launch --no-deploy   # rename the app in fly.toml first if "on-deck" is taken
fly secrets set \
  SESSION_SECRET=... \
  TMDB_API_KEY=... \
  ANTHROPIC_API_KEY=... \
  DATABASE_URL=...       # same Postgres (Supabase) instance used locally
fly deploy
```

Subsequent deploys are just `fly deploy`. The database is external
(Supabase) and isn't managed by Fly — nothing to provision there.
