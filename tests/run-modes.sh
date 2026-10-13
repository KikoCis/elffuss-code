#!/usr/bin/env bash
# Runs Code's suites in both modes, and level 2's own suites once.
#
#   tests/run-modes.sh                      every suite in tests/suites.txt
#   tests/run-modes.sh --only codeedit,e2e  just these (from any section)
#   tests/run-modes.sh --mode default       only one mode (default | ext | both)
#   tests/run-modes.sh --no-once            leave out level 2's own suites
#
# One loopback server (tests/lib/x2-server.mjs: Code on 127.0.0.1, the sandbox
# on localhost, both on one random port) serves every suite. A suite in [both]
# runs as "node S.mjs" (default mode) and as "node --import ./lib/x2-mode.mjs
# S.mjs" (extension mode: two code extensions installed and running in the
# sandbox while the suite works, and three more checks at the end). A suite
# passes when it exits 0, prints at least one ✅ (or ✓) and no ❌ (or ✗). The script fails if
# any suite fails in either mode. Logs go to a temporary folder; no timings.
set -uo pipefail
set -m                                   # each suite in its own process group
cd "$(dirname "$0")"

MODE=both ONLY="" ONCE=1 TIMEOUT="${SUITE_TIMEOUT:-900}"
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --only) ONLY=",$2,"; shift 2 ;;
    --no-once) ONCE=0; shift ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done
case "$MODE" in default|ext|both) ;; *) echo "--mode is default, ext or both"; exit 2 ;; esac

# suites.txt: the names in one section
section() { awk -v s="[$1]" '/^\[/{on=($0==s); next} on && NF && $1 !~ /^#/ {print $1}' suites.txt; }
pick() { if [ -z "$ONLY" ]; then cat; else while read -r n; do case "$ONLY" in *",$n,"*) echo "$n" ;; esac; done; fi; }

BOTH=$(section both | pick)
ONCE_LIST=""; [ "$ONCE" = 1 ] && ONCE_LIST=$(section once | pick)
if [ -n "$ONLY" ]; then
  for n in $(echo "$ONLY" | tr ',' ' '); do
    if ! { echo "$BOTH"; echo "$ONCE_LIST"; } | grep -qx "$n"; then
      if section not-run | grep -qx "$n:\?"; then echo "$n is in [not-run]"; else echo "$n is not in tests/suites.txt"; fi
      exit 2
    fi
  done
fi
for n in $BOTH $ONCE_LIST; do [ -f "$n.mjs" ] || { echo "missing suite: $n.mjs"; exit 2; }; done

TMPROOT="${TMPDIR:-/tmp}"
LOGS=$(mktemp -d "${TMPROOT%/}/elffuss-run-modes.XXXXXX")
export SCRATCH="$LOGS/scratch"
mkdir -p "$SCRATCH"

node lib/x2-server.mjs > "$LOGS/server.log" 2>&1 &
SERVER=$!
cleanup() { kill -TERM -- -"$SERVER" 2>/dev/null; wait "$SERVER" 2>/dev/null; }
trap cleanup EXIT
trap 'exit 130' INT TERM
BASE=""
for _ in $(seq 1 100); do
  BASE=$(sed -n 's#^Code *\(http://127\.0\.0\.1:[0-9]*\)/$#\1#p' "$LOGS/server.log" | head -1)
  [ -n "$BASE" ] && break
  sleep 0.1
done
[ -n "$BASE" ] || { echo "the test server did not start:"; cat "$LOGS/server.log"; exit 1; }
export BASE
echo "BASE=$BASE   logs: $LOGS"

# run one suite in one mode, with a watchdog on its process group
run() {   # name mode → sets RC, OKS, BAD, SKIP
  local name=$1 mode=$2 log="$LOGS/$1.$2.log"
  if [ "$mode" = ext ]; then node --import ./lib/x2-mode.mjs "$name.mjs" > "$log" 2>&1 &
  else node "$name.mjs" > "$log" 2>&1 &
  fi
  local pid=$!
  ( sleep "$TIMEOUT"; echo "❌ run-modes: stopped after the suite's time limit" >> "$log"; kill -TERM -- -"$pid" 2>/dev/null; sleep 5; kill -KILL -- -"$pid" 2>/dev/null ) &
  local dog=$!
  wait "$pid"; RC=$?
  kill -TERM -- -"$dog" 2>/dev/null; wait "$dog" 2>/dev/null
  # ✅/❌ per check; the two batteries mark their cases with ✓/✗ at the start of a line
  OKS=$(( $(grep -c '✅' "$log") + $(grep -c '^ *✓ ' "$log") ))
  BAD=$(( $(grep -c '❌' "$log") + $(grep -c '^ *✗ ' "$log") ))
  SKIP=$(grep -c 'NOT RUN' "$log")
}
verdict() {   # → PASS | FAIL | NOT RUN, and "no IDE" when extension mode was not exercised
  if [ "$RC" -eq 0 ] && [ "$BAD" -eq 0 ] && [ "$OKS" -gt 0 ]; then
    if [ "${2:-}" = ext ] && grep -q 'x2-mode: not exercised' "$LOGS/$1.ext.log"; then echo "PASS, no IDE"; else echo PASS; fi
  elif [ "$RC" -eq 0 ] && [ "$BAD" -eq 0 ] && [ "$SKIP" -gt 0 ]; then echo "NOT RUN"
  else echo FAIL; fi
}

fails=0 suites=0 noide=""
printf '\n%-24s %-22s %-30s\n' suite default extension
for n in $BOTH; do
  suites=$((suites + 1))
  cols=""
  for m in default ext; do
    if [ "$MODE" != both ] && [ "$MODE" != "$m" ]; then cols="$cols$(printf '%-22s ' '-')"; continue; fi
    run "$n" "$m"
    v=$(verdict "$n" "$m")
    [ "$v" = FAIL ] && fails=$((fails + 1))
    [ "$v" = "PASS, no IDE" ] && noide="$noide $n"
    cols="$cols$(printf '%-22s ' "$v $OKS ok $BAD bad")"
  done
  printf '%-24s %s\n' "$n" "$cols"
  for m in default ext; do
    f="$LOGS/$n.$m.log"
    [ -f "$f" ] || continue
    if [ "$(grep -c '❌\|^ *✗ ' "$f")" -gt 0 ] || ! grep -q '✅\|^ *✓ ' "$f"; then grep '❌\|^ *✗ \|Error\|NOT RUN' "$f" | head -4 | sed "s/^/    [$m] /"; fi
  done
done
for n in $ONCE_LIST; do
  suites=$((suites + 1))
  run "$n" once
  v=$(verdict)
  [ "$v" = FAIL ] && fails=$((fails + 1))
  printf '%-24s %-22s\n' "$n" "$v $OKS ok $BAD bad (once)"
  [ "$v" = FAIL ] && grep '❌\|Error' "$LOGS/$n.once.log" | head -4 | sed 's/^/    /'
done

echo
# (sin IDE el recinto no corrió: pasan, pero el modo extensiones no las probó)
if [ -n "$noide" ]; then echo "ℹ️  extension mode not exercised (no page opened the IDE, the sandbox never ran):$noide"; fi
if [ "$fails" -eq 0 ]; then echo "✅ run-modes: $suites suites, no failures"; else echo "❌ run-modes: $fails failing runs in $suites suites (logs: $LOGS)"; fi
[ "$fails" -eq 0 ]
