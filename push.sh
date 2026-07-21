#!/bin/bash
#
# push.sh — safely commit & push the Betterservice app.
# Clears any stuck git process / leftover lock first, then commits and pushes.
#
# Run it with:   bash ~/Desktop/betterservice-app/push.sh
#

set -u
REPO="/Users/ben/Desktop/betterservice-app"
cd "$REPO" || { echo "❌ Can't find the repo at $REPO"; exit 1; }

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
git commit -m "Security hardening, job integrity, parts history + UI polish" \
           -m "- 0027: lock down outstanding_statements & due_for_sms_reminder; staff-only storage buckets" \
           -m "- 0028: atomic stock (add_part_to_job / remove_job_line_item) + lock line items once invoiced" \
           -m "- 0029: auto-log parts used, by machine make + model" \
           -m "- hide time-check nudge for owners; new logo on login + dashboard; new-job form moved to a popup" \
  || echo "   nothing new to commit."

echo "⑥ Pushing to GitHub (Vercel will redeploy)…"
git push

echo "✅ Done — check Vercel for the new deploy."
