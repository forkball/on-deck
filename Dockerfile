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

# npm start runs db:migrate (idempotent — only applies new migrations) then
# starts the server; fine to run on every boot for a single-machine deploy.
CMD ["npm", "start"]
