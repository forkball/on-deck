# No build step: the app runs TypeScript directly at runtime via
# remix/node-tsx (backed by oxc-transform, not the `typescript` package), so
# `npm ci --omit=dev` is enough — devDependencies aren't needed to run.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app ./app
COPY db ./db
COPY public ./public
COPY server.ts tsconfig.json ./

ENV NODE_ENV=production
EXPOSE 8080

# Just the server. Migrations are a deploy step, not a boot step — see
# release_command in fly.toml. The app runs on more than one machine, so
# migrating from here meant every machine racing to apply the same migration
# on every boot (and on every cold-start wake, given min_machines_running=0).
CMD ["npm", "start"]
