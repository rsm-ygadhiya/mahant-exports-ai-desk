#!/bin/bash
# Double-clickable launcher for the Mahant Exports app.
# - First run: walks you through database setup, installs deps, runs migrations, seeds.
# - Every run after: just starts the server and opens the browser.
# Close this Terminal window (or Ctrl+C) to stop the server.

set -e

# Resolve paths relative to this script so it works wherever the folder lives.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/ui/web"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"

cd "$PROJECT_DIR" 2>/dev/null || {
  echo "❌ Could not find the web app at: $PROJECT_DIR"
  echo "   Keep this .command file next to the 'web' folder."
  read -p "Press Return to close…"
  exit 1
}

# Make sure node + npm are on PATH (when launched from Finder, PATH is minimal).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ Node.js / npm not found."
  echo "   Install from https://nodejs.org (the LTS version), then re-open this shortcut."
  open "https://nodejs.org"
  read -p "Press Return to close…"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────
#  FIRST-RUN WIZARD
# ─────────────────────────────────────────────────────────────────────
needs_setup=false
if [ ! -f "$ENV_FILE" ]; then
  needs_setup=true
elif grep -q '^DATABASE_URL="postgresql://postgres:postgres@localhost' "$ENV_FILE" 2>/dev/null; then
  needs_setup=true
elif ! grep -q '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null; then
  needs_setup=true
fi

if [ "$needs_setup" = true ]; then
  clear
  cat <<'WELCOME'
   ╔══════════════════════════════════════════════════════════╗
   ║       MAHANT EXPORTS — FIRST-RUN SETUP                   ║
   ╚══════════════════════════════════════════════════════════╝

   Looks like this is your first time. We need a database.

   The easiest option is Neon — free, hosted, takes 2 minutes:

     1.  I'll open https://console.neon.tech in your browser.
     2.  Sign in (GitHub or Google works fine).
     3.  Create a new project (any name, leave defaults).
     4.  On the project dashboard, find the "Connection Details"
         box. Make sure "Pooled connection" is selected.
     5.  Click the COPY button next to the connection string.
         It looks like:
            postgresql://neondb_owner_xxx:npg_xxx@ep-xxx-pooler.…/neondb?sslmode=require

     6.  Come back here and paste it when prompted.

WELCOME
  read -p "   Press Return to open Neon in your browser…"
  open "https://console.neon.tech"
  echo ""

  # Loop until we get a plausible postgres URL.
  while true; do
    echo "   Paste your Neon connection string and press Return:"
    echo "   (right-click → Paste, or Cmd+V)"
    printf "   > "
    read -r DB_URL
    echo ""

    # Strip surrounding quotes/whitespace.
    DB_URL="${DB_URL#\"}"; DB_URL="${DB_URL%\"}"
    DB_URL="${DB_URL#\'}"; DB_URL="${DB_URL%\'}"
    DB_URL="$(echo "$DB_URL" | xargs)"

    if [[ "$DB_URL" == postgresql://* || "$DB_URL" == postgres://* ]]; then
      break
    fi
    echo "   ⚠️  That doesn't look like a Postgres URL. It should start with"
    echo "       'postgresql://'. Try again."
    echo ""
  done

  # Generate a strong random JWT secret.
  JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"

  # Start from the example, then patch the two values we just gathered.
  cp "$ENV_EXAMPLE" "$ENV_FILE"

  # Use a temp file to avoid sed quoting issues with special chars in the URL.
  python3 - "$ENV_FILE" "$DB_URL" "$JWT_SECRET" <<'PY' 2>/dev/null || true
import sys, pathlib
p, db, secret = sys.argv[1], sys.argv[2], sys.argv[3]
text = pathlib.Path(p).read_text().splitlines()
out = []
for line in text:
    if line.startswith("DATABASE_URL="):
        out.append(f'DATABASE_URL="{db}"')
    elif line.startswith("JWT_SECRET="):
        out.append(f'JWT_SECRET="{secret}"')
    else:
        out.append(line)
pathlib.Path(p).write_text("\n".join(out) + "\n")
PY

  echo "   ✅ Saved your settings to .env"
  echo ""
  echo "   📦  Installing dependencies (one-time, ~1 minute)…"
  npm install
  echo ""
  echo "   🗄️   Setting up the database tables…"
  # `migrate dev --name init` creates AND applies the migration. We can't use
  # `migrate deploy` here because on a fresh project there are no migration
  # files yet — it would silently succeed with nothing to do.
  npx prisma migrate dev --name init --skip-seed
  echo ""
  echo "   🌱  Seeding sample data (admin user + 60 sample stones)…"
  npm run seed
  echo ""
  echo "   ✅ All set!"
  echo ""
  sleep 2
fi

# ─────────────────────────────────────────────────────────────────────
#  REGULAR RUN
# ─────────────────────────────────────────────────────────────────────

# Make sure deps are installed (they should be, but handle the rare missing case).
if [ ! -d node_modules ]; then
  echo "📦  Installing dependencies…"
  npm install
fi

# Make sure Prisma client is generated (cheap if already done).
npx prisma generate >/dev/null 2>&1 || true

clear
cat <<'BANNER'
   ╔══════════════════════════════════════════════════════╗
   ║       MAHANT EXPORTS — LAB GROWN DIAMONDS            ║
   ║                                                      ║
   ║   Storefront → http://localhost:3000                 ║
   ║   Admin      → http://localhost:3000/admin/login     ║
   ║                                                      ║
   ║   Default admin login:                               ║
   ║     admin@mahant.test  /  admin123                   ║
   ║                                                      ║
   ║   Press Ctrl+C in this window to stop.               ║
   ╚══════════════════════════════════════════════════════╝
BANNER
echo ""

# Open the browser after the server has had a moment to start.
( sleep 4 && open "http://localhost:3000" ) &

# Start the dev server in the foreground so logs are visible / Ctrl+C stops it.
npm run dev
