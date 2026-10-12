#!/usr/bin/env bash
#
# `npm run verify`, one at a time across every worktree on this machine.
#
# Every worktree shares one dev database (:5433) and the gate force-reseeds
# it, and Playwright binds :3100 with reuseExistingServer off. So two gates
# running at once wipe each other's data and fight over the port, and both
# fail with errors that look like real regressions. `scripts/herd.sh` starts
# one agent per backlog issue, which makes overlapping gates the normal case.
# The verifier subagent runs the gate through this script for that reason.
#
# The lock is a directory, because `mkdir` is atomic and macOS ships no
# `flock`. The holder writes its pid into it, so a lock left behind by a
# killed run is detected and taken over rather than waited on forever. It is
# a fixed path rather than $TMPDIR, which can differ between sessions and
# would quietly give each agent a lock of its own.
#
# Usage: scripts/verify-serial.sh   (from inside the worktree to verify)

set -euo pipefail

LOCK=/tmp/resumix-verify.lock
waited=0

while ! mkdir "$LOCK" 2>/dev/null; do
  holder=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    echo "verify-serial: taking over a stale lock from dead pid $holder" >&2
    rm -rf "$LOCK"
    continue
  fi
  if [ $((waited % 60)) -eq 0 ]; then
    echo "verify-serial: gate busy (pid ${holder:-?}, $(cat "$LOCK/dir" 2>/dev/null || echo '?')), waiting..." >&2
  fi
  sleep 5
  waited=$((waited + 5))
done

trap 'rm -rf "$LOCK"' EXIT
echo $$ >"$LOCK/pid"
pwd >"$LOCK/dir"

npm run verify
