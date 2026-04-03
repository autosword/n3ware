# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# Install production deps only
RUN npm ci --omit=dev

# ── Stage 2: final image ──────────────────────────────────────────────────────
FROM node:22-alpine AS final
WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S n3ware && adduser -S -u 1001 -G n3ware n3ware

# Copy production deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY --chown=n3ware:n3ware . .

# Ensure data directory exists and is writable (local storage fallback)
RUN mkdir -p /app/data/sites && chown -R n3ware:n3ware /app/data

USER n3ware

# Cloud Run injects PORT; default 8080
ENV PORT=8080 \
    NODE_ENV=production \
    STORAGE_BACKEND=local

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/ || exit 1

CMD ["node", "server.js"]
