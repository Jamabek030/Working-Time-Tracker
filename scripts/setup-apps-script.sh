#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/setup-apps-script.sh
#
# One-command creation and refresh of the Apps Script test project for this
# repository. Uses clasp — Google's official Apps Script CLI — so this is
# the canonical automated path. No file is copied by hand.
#
# What this script does:
#   * Stages appsscript.json into src/ (clasp expects the manifest under its
#     rootDir).
#   * On a first run, creates a NEW Apps Script project bound to the Google
#     Sheet whose id you pass as SHEET_ID. On subsequent runs, pushes to the
#     same project (whose id is recorded in .clasp.json by clasp).
#   * Pushes every src/*.gs and src/*.html to the project.
#   * Opens the editor so you can select `runTests` and click Run.
#
# What this script will NOT do:
#   * It will not deploy the web app.
#   * It will not call `enableOpenAccess()`.
#   * It will not send real emails.
#   * It will not touch any Google Cloud project you did not pass in.
#
# One-time human prerequisites (do these on your own machine, once per
# Google account):
#
#   1. Install Node.js 18+ and clasp:
#        npm install -g @google/clasp
#
#   2. Enable the Apps Script API for your Google account:
#        https://script.google.com/home/usersettings
#      Toggle "Google Apps Script API" to ON.
#
#   3. Run `clasp login` (opens a browser the first time). On a headless
#      machine, use `clasp login --no-localhost` and paste the code back.
#
# Then, from the repo root:
#
#   SHEET_ID=<id of your test spreadsheet> ./scripts/setup-apps-script.sh
#
# Subsequent runs can omit SHEET_ID — clasp remembers the project via
# .clasp.json (gitignored).
#
# Example:
#   SHEET_ID=<id of your test spreadsheet> \
#     ./scripts/setup-apps-script.sh
# ---------------------------------------------------------------------------

set -euo pipefail

SHEET_ID="${SHEET_ID:-}"
TITLE="${TITLE:-Working-Time-Tracker-Test}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

echo "==> Repo root: $repo_root"

if ! command -v clasp >/dev/null 2>&1; then
  echo "ERROR: clasp is not installed." >&2
  echo "       Install it with:  npm install -g @google/clasp" >&2
  exit 1
fi
echo "==> clasp: $(clasp --version 2>&1 | head -1)"

# clasp exits non-zero when not logged in. Capture status without aborting.
set +e
login_status="$(clasp show-authorized-user 2>&1)"
login_rc=$?
set -e
if [ $login_rc -ne 0 ] || ! printf '%s' "$login_status" | grep -qiE 'logged in as'; then
  echo "ERROR: clasp is not authenticated." >&2
  echo "       Run:  clasp login" >&2
  echo "       (On a headless machine: clasp login --no-localhost)" >&2
  exit 1
fi
echo "==> clasp login OK"

if [ -f .clasp.json ]; then
  echo "==> Found existing .clasp.json — pushing to the configured project."
else
  if [ -z "$SHEET_ID" ]; then
    echo "ERROR: SHEET_ID not set and no .clasp.json yet." >&2
    echo "       Pass SHEET_ID=<spreadsheet id> on the first run." >&2
    exit 1
  fi
  echo "==> Creating container-bound script \"$TITLE\" on sheet $SHEET_ID"
  clasp create --title "$TITLE" --parentId "$SHEET_ID" --rootDir src
fi

# Stage the manifest inside rootDir=src/ so clasp picks it up. This must come
# AFTER `clasp create`, which overwrites src/appsscript.json with the default.
cp -f appsscript.json src/appsscript.json
echo "==> Staged src/appsscript.json from repo root (gitignored copy)"

echo "==> Pushing src/ to Apps Script..."
clasp push -f

echo
echo "SUCCESS. Open the Apps Script editor:"
clasp open-script 2>/dev/null || clasp open || true
echo
echo "Next steps in the editor (not automated — they require a browser session):"
echo "  1. Pick 'runTests' from the function dropdown."
echo "  2. Click Run. Approve OAuth scopes on first run."
echo "  3. View -> Logs for the summary line like '20/20 passed'."
echo "  4. Paste the summary line (and any FAIL lines) back to the chat."
