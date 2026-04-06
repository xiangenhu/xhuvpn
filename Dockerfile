# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# node-ssh needs openssh-client for key parsing
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-client \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Cloud Run injects PORT — default 8080
ENV PORT=8080
EXPOSE 8080

# Non-root user for security
RUN useradd -m appuser
USER appuser

CMD ["node", "server.js"]
