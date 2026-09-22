FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node db ./db

USER node
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
