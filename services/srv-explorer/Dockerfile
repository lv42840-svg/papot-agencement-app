FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node server.mjs files.mjs ./
COPY --chown=node:node public ./public
ENV NODE_ENV=production PORT=3003 SRV_ROOT=/data
USER node
CMD ["node", "server.mjs"]
