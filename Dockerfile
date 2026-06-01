# ─────────────────────────────────────────────────────────────────────────
# Mahant Exports — single-image deploy for Render / Fly / any Docker host.
#
# This repo bundles BOTH halves of the stack:
#   • Next.js admin + storefront           → ui/web/
#   • Python orchestrator + skills (m3)    → scripts/, automations/, data/
#
# At runtime the Next.js process spawns `uv run python scripts/orchestrator.py`
# against /app (the repo root), so Node + Python both live in one image.
#
# Build & run locally:
#   docker build -t mahant .
#   docker run -p 3000:3000 --env-file ui/web/.env mahant
# ─────────────────────────────────────────────────────────────────────────

# ===== Stage 1 — build the Next.js app =================================
FROM node:20-bookworm-slim AS web-builder

WORKDIR /app/web

RUN apt-get update && apt-get install -y --no-install-recommends \
        openssl ca-certificates \
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
    M3_REPO_PATH=/app

# Python 3 + git + OpenSSL + curl (for uv installer & healthchecks).
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-venv python3-pip \
        openssl ca-certificates git curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (same Python package manager used locally).
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/uv \
    && uv --version

WORKDIR /app

# Copy the m3 half of the repo — orchestrator + skills + seed data + python deps.
# Listed file-by-file so we don't drag the entire ui/web tree into /app and
# blow up the image with duplicate node_modules.
COPY automations ./automations
COPY scripts ./scripts
COPY data ./data
COPY utils ./utils
COPY skills ./skills
COPY rag ./rag
COPY mcp ./mcp
COPY tests ./tests
COPY pyproject.toml uv.lock conftest.py ./

# Install Python dependencies for the orchestrator.
RUN uv sync --frozen --no-dev

# Copy the built Next.js app from stage 1 into /app/web.
COPY --from=web-builder /app/web/.next        ./web/.next
COPY --from=web-builder /app/web/package*.json ./web/
COPY --from=web-builder /app/web/node_modules ./web/node_modules
COPY --from=web-builder /app/web/prisma       ./web/prisma
COPY --from=web-builder /app/web/next.config.* ./web/

EXPOSE 3000

# Render injects $PORT — use it if set, otherwise default to 3000.
# Boot sequence:
#   1. From /app, fire Scintilla in the background so data/working/*.csv
#      exists by the time anyone visits /admin/evals. Render's free tier
#      filesystem is ephemeral — every cold start wipes these CSVs, so we
#      regenerate them on boot. The orchestrator takes ~30s; Next.js
#      doesn't wait for it (the &), so the site comes up fast.
#   2. From /app/web, start Next.js on $PORT.
WORKDIR /app
CMD ["sh", "-c", "(cd /app && uv run python scripts/orchestrator.py --today $(date +%Y-%m-%d) > /tmp/scintilla-boot.log 2>&1 &) ; cd /app/web && npx next start -p ${PORT:-3000}"]
