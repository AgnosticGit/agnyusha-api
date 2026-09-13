# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nestjs \
  && mkdir -p /app/uploads \
  && chown -R nestjs:nodejs /app

# Production node_modules (keep prisma CLI for migrate deploy)
COPY --from=build --chown=nestjs:nodejs /app/package.json ./
COPY --from=build --chown=nestjs:nodejs /app/package-lock.json ./
COPY --from=build --chown=nestjs:nodejs /app/node_modules ./node_modules
RUN npm prune --omit=dev \
  && npm install prisma@6.19.3 --omit=dev --no-save \
  && chown -R nestjs:nodejs /app/node_modules

COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/prisma ./prisma
COPY --chown=nestjs:nodejs docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER nestjs
EXPOSE 3001
ENTRYPOINT ["/app/entrypoint.sh"]
