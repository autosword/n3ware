# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY . .

ENV PORT=8080 \
    NODE_ENV=production \
    STORAGE_BACKEND=firestore

EXPOSE 8080

# Run as non-root
USER node

CMD ["node", "server.js"]
