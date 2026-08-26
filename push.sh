#!/bin/bash
#
# push.sh — safely commit & push the Betterservice app.
# Clears any stuck git process / leftover lock first, then commits and pushes.
#
# Run it with:   bash push.sh "what you changed"
# (from anywhere — the script finds its own repo)
#

set -u

# Find the repo from where THIS script lives, so moving the folder can't break it.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO" || { echo "❌ Can't find the repo at $REPO"; exit 1; }

# Commit message: use what you passed in, or ask for one.
if [ $# -ge 1 ] && [ -n "$1" ]; then
  MSG="$1"
else
  read -r -p "Commit message: " MSG
  [ -n "$MSG" ] || { echo "❌ Need a commit message. Nothing pushed."; exit 1; }
fi

echo "Repo: $REPO"

echo "① Finding any git processes still running…"
pgrep -lx git || echo "   none running — good."

echo "② Killing a stuck git if there is one…"
pkill -x git 2>/dev/null && echo "   killed a stuck git." || echo "   nothing to kill."

echo "③ Clearing a stale lock if git left one behind…"
if [ -f .git/index.lock ]; then
  rm -f .git/index.lock && echo "   removed .git/index.lock"
else
  echo "   no lock file — good."
fi

echo "④ Staging every change…"
git add -A

echo "⑤ Committing…"
git commit -m "$MSG" || echo "   nothing new to commit."

echo "⑥ Pushing to GitHub (Vercel will redeploy)…"
git push || { echo "❌ Push failed — nothing deployed. Fix the error above and re-run."; exit 1; }

echo "✅ Done — check Vercel for the new deploy."
