# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY extension ./extension
COPY scripts/build-extensions.js ./scripts/build-extensions.js
RUN node scripts/build-extensions.js

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# node-ssh needs openssh-client for key parsing
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-client \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY . .
COPY --from=builder /app/public/downloads ./public/downloads

# Cloud Run injects PORT — default 8080
ENV PORT=8080
EXPOSE 8080

# Non-root user for security
RUN useradd -m appuser
USER appuser

COPY oauth-infrastructure.mjs ./oauth-infrastructure.mjs
CMD ["node", "--import", "./oauth-infrastructure.mjs", "server.js"]

