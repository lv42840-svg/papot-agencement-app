FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder

WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3002

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      fonts-dejavu-core \
      fonts-liberation2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/docs/templates ./docs/templates
COPY --from=dependencies /app/node_modules ./node_modules

RUN mkdir -p /srv/papot/agencement/documents /srv/papot/agencement/modeles \
    && chown -R node:node /app /srv/papot/agencement

USER node

EXPOSE 3002

CMD ["node", "server.js"]
