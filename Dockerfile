# ─────────────────────────────────────────────────────────────────────────
# Mahant Exports — single-image deploy for Render / Fly / any Docker host.
#
# Bundles BOTH halves of the stack in one container:
#   • Next.js admin + storefront (this repo)               → /app/web
#   • mgt449-milestone03 Python orchestrator + skills      → /app/m3
#
# The Scintilla autopilot spawns `uv run python …` against /app/m3 from
# inside the Next.js process, so Node and Python must coexist in the
# runtime image.
#
# Build & run locally:
#   docker build -t mahant .
#   docker run -p 3000:3000 --env-file ui/web/.env mahant
# ─────────────────────────────────────────────────────────────────────────

# ===== Stage 1 — build the Next.js app =================================
FROM node:20-bookworm-slim AS web-builder

WORKDIR /app/web

# Install OpenSSL (Prisma needs it for query engine binaries) + git.
RUN apt-get update && apt-get install -y --no-install-recommends \
        openssl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# Install Node deps first (cached layer).
COPY ui/web/package*.json ./
RUN npm ci --no-audit --no-fund

# Bring in the rest of the web source, generate Prisma client, build.
COPY ui/web/ ./
RUN npx prisma generate
RUN npm run build


# ===== Stage 2 — runtime image =========================================
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    PYTHONUNBUFFERED=1 \
    M3_REPO_PATH=/app/m3

# Python 3 + git + OpenSSL + curl (for uv installer & healthchecks).
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-venv python3-pip \
        openssl ca-certificates git curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (the same Python package manager the m3 repo uses locally).
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/uv \
    && uv --version

# ---- Clone & install the Python orchestrator ----
# Cloning at build time keeps the deploy artifact self-contained; the m3
# repo is public so no secrets are needed. To pin a specific commit, set
# M3_GIT_REF as a build arg.
ARG M3_GIT_REF=main
RUN git clone --depth 1 --branch ${M3_GIT_REF} \
    https://github.com/rsm-genai-2026/mgt449-milestone03-Group-10.git \
    /app/m3

WORKDIR /app/m3
RUN uv sync --frozen --no-dev

# ---- Copy the built Next.js app from stage 1 ----
WORKDIR /app/web
COPY --from=web-builder /app/web/.next ./.next
COPY --from=web-builder /app/web/public ./public
COPY --from=web-builder /app/web/package*.json ./
COPY --from=web-builder /app/web/node_modules ./node_modules
COPY --from=web-builder /app/web/prisma ./prisma
COPY --from=web-builder /app/web/next.config.* ./

EXPOSE 3000

# Render injects $PORT — use it if set, otherwise default to 3000.
CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
