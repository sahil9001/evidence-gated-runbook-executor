#!/usr/bin/env bash
#
# Runs the whole stack locally: the RunProof backend Worker and the Next.js
# frontend, together, from one command.
#
#   ./scripts/dev.sh
#
# Installs dependencies if they are missing, applies the local D1 migrations
# (without which every backend query fails on a missing table), starts both
# servers, and waits until each actually answers before telling you so.
# Ctrl+C stops both.

set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly API_PORT=8787
readonly WEB_PORT=3000
readonly API_URL="http://localhost:${API_PORT}"
readonly WEB_URL="http://localhost:${WEB_PORT}"
# Generous because a cold `wrangler dev` downloads and boots workerd, and a
# cold `next dev` compiles the first route on demand.
readonly READY_TIMEOUT_SECONDS=90
# How often to say "still working" while waiting on a server.
readonly HEARTBEAT_SECONDS=5
# Ceiling on a single readiness probe. Clamped down further near the deadline
# so no one attempt can carry the total wait past READY_TIMEOUT_SECONDS.
readonly CURL_TIMEOUT_SECONDS=2

readonly BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m' RESET=$'\033[0m'

api_pid=""
web_pid=""

log()  { printf '%s[dev]%s %s\n' "$BOLD" "$RESET" "$*"; }
warn() { printf '%s[dev]%s %s\n' "$RED" "$RESET" "$*" >&2; }
die()  { warn "$*"; exit 1; }

# Seconds since the script started. $SECONDS is a bash builtin counter.
readonly STARTED_AT=$SECONDS

format_duration() {
  local total=$1
  if (( total < 60 )); then
    printf '%ds' "$total"
  else
    printf '%dm%02ds' "$(( total / 60 ))" "$(( total % 60 ))"
  fi
}

# Logs how long the step that began at $1 took. Every slow step reports, so a
# quiet stretch is always attributable rather than looking like a hang.
log_done() {
  local began=$1 what=$2
  log "${GREEN}✓${RESET} ${what} in $(format_duration $(( SECONDS - began )))"
}

# Runs on Ctrl+C, on SIGTERM, and on any exit. It relies on this script being
# the process that receives the interrupt, which is why job control is scoped
# to the forks in start_server rather than left on for the whole run — see the
# comment there.
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  # Nothing started yet (a failed preflight, say) means nothing to stop, and
  # announcing a shutdown there just muddies the error above.
  if [[ -z "$api_pid$web_pid" ]]; then
    exit "$status"
  fi
  printf '\n'
  log "shutting down..."
  # Frontend first: it talks to the backend, so stopping it first avoids a
  # burst of connection errors on the way out.
  local pid
  for pid in "$web_pid" "$api_pid"; do
    [[ -n "$pid" ]] || continue
    # Negative PID targets the process group, so children die with the parent.
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  # Give them the chance to shut down on their own terms before this script
  # goes away; without this the servers outlive their own SIGTERM handlers.
  wait 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT INT TERM

# True when something is already listening on the port. Deliberately not
# bash's /dev/tcp: some builds ship with net redirections disabled, and a
# sandbox can block them, in which case every port silently looks free and the
# real failure surfaces later as a confusing "address in use" from wrangler.
port_in_use() {
  local port=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  # curl exits 7 and only 7 when it cannot open the connection at all. Any
  # other outcome — a response, or a timeout mid-request — means something is
  # there.
  curl -sS -o /dev/null --max-time 2 "http://127.0.0.1:${port}" >/dev/null 2>&1
  (( $? == 7 )) && return 1
  return 0
}

require_free_port() {
  local port=$1 what=$2
  if port_in_use "$port"; then
    die "port $port is already in use, and the $what needs it.
      Find it with:  lsof -ti tcp:$port
      Then stop it, or stop whatever other copy of this script is running."
  fi
}

install_if_needed() {
  local dir=$1
  [[ -d "$ROOT/$dir/node_modules" ]] && return 0
  local began=$SECONDS
  log "installing $dir dependencies — first run only, typically 30-90s..."
  # Deliberately not --silent. This is by far the longest step, and hiding
  # npm's own progress is what makes a first run look like a hang.
  if [[ -f "$ROOT/$dir/package-lock.json" ]]; then
    (cd "$ROOT/$dir" && npm ci --no-fund --no-audit)
  else
    (cd "$ROOT/$dir" && npm install --no-fund --no-audit)
  fi
  log_done "$began" "installed $dir dependencies"
}

# A pid and every process beneath it. `npm run dev` execs into npm, which then
# spawns the real server as a child, so the pid this script holds is never the
# process that actually listens — or the one that can get itself stopped.
descendant_pids() {
  local root=$1 child
  printf '%s\n' "$root"
  for child in $(pgrep -P "$root" 2>/dev/null); do
    descendant_pids "$child"
  done
}

# True when the process or anything under it is stopped (state T). A stopped
# process stays alive, so `kill -0` cannot see the difference.
tree_has_stopped_process() {
  local pid
  for pid in $(descendant_pids "$1"); do
    case "$(ps -o state= -p "$pid" 2>/dev/null | tr -d ' \n')" in
      T*) return 0 ;;
    esac
  done
  return 1
}

# Starts `npm run dev` in $1 and reports the new pid in $started_pid. The pid
# comes back in a global rather than on stdout because `pid=$(start_server x)`
# would hang: the background job inherits the command substitution's pipe, so
# bash waits for the server to exit before the assignment completes.
#
# Two details in here are load-bearing.
#
# `set -m` around the fork, and only around the fork. A process group is
# assigned when a job is created, so enabling job control for that instant is
# enough to give the server its own group — which is what lets cleanup signal
# the whole tree with a negative pid, since `next dev` and `wrangler dev` both
# spawn children that outlive a bare `kill <pid>` on the parent. It goes off
# again immediately because while job control is on bash ALSO puts its own
# foreground commands in their own process group and hands them the terminal:
# the `sleep` in main's wait loop would own the terminal, so Ctrl+C would
# deliver SIGINT to that `sleep` and never to this script. Bash then falls
# back to running the handler itself, but with the function context already
# unwound — it prints "pop_var_context: head of shell_variables not a function
# context", the first `local` in cleanup fails with "can only be used in a
# function", and under `set -e` the handler aborts on that line, leaving both
# servers running with their ports still bound. That was the Ctrl+C bug.
#
# `</dev/null` is likewise not tidiness. `wrangler dev` puts stdin in raw mode
# for its hotkeys ([x] to exit and friends) when it is a TTY — its bundled CLI
# calls setRawMode in seven places. Raw mode is a tcsetattr on the controlling
# terminal, and the server is in a BACKGROUND process group by the line above,
# so the kernel answers that call with SIGTTOU, which STOPS the process rather
# than killing it. What you see is a server that prints its startup banner,
# suspends before it ever listens, and stays alive — so a liveness check finds
# nothing wrong while the port never opens. A non-TTY stdin makes wrangler skip
# raw mode entirely and run non-interactively, as it does in CI. `next dev`
# does not currently touch raw mode, so it is not exposed to this today; it
# gets the same treatment because the hazard is in the arrangement rather than
# the tool, and the cost is nothing.
started_pid=""
start_server() {
  local dir=$1
  set -m
  (cd "$ROOT/$dir" && exec npm run --silent dev) </dev/null &
  started_pid=$!
  set +m
}

# Polls until the URL answers at all. Any HTTP status counts: the frontend
# answers 404 on / until the first compile finishes, and that still means the
# server is up.
#
# Emits a heartbeat while waiting. Both servers print their own startup noise
# and then go quiet well before they actually serve, so without this the gap
# reads as a hang rather than as progress.
wait_until_up() {
  local url=$1 what=$2 pid=$3
  # Wall-clock, not an iteration count. Each pass can burn up to two seconds in
  # curl on top of its own sleep, so counting passes would report "5s" a good
  # fifteen seconds in — and would stretch the timeout itself well past the 90s
  # it claims. Both would mislead precisely when startup is slow, which is the
  # only time anyone reads this.
  local began=$SECONDS elapsed=0 remaining=0 next_heartbeat=$HEARTBEAT_SECONDS
  # The deadline is a real bound, not an approximate one. Two things are needed
  # for that, and only having the first is why an earlier version still
  # overran: read the clock at the top of each pass so the guard tests the
  # current time rather than the previous pass's, AND size the work inside the
  # pass to the budget that is actually left. A pass admitted at 89s that is
  # then free to spend two seconds in curl and one sleeping finishes at 92s,
  # which is not a 90s timeout however the guard is written.
  while :; do
    elapsed=$(( SECONDS - began ))
    remaining=$(( READY_TIMEOUT_SECONDS - elapsed ))
    (( remaining > 0 )) || break
    if ! kill -0 "$pid" 2>/dev/null; then
      die "the $what exited before it came up. Its output is above."
    fi
    # A suspended server stays alive forever, so `kill -0` above cannot see it.
    # Report it as its own case rather than letting it burn the full timeout
    # and then blame a slow start. Checked across the whole tree: the stopped
    # process is the server itself, several levels below the pid held here.
    if tree_has_stopped_process "$pid"; then
      die "the $what was suspended before it started listening.
      That usually means it tried to read the terminal from the background.
      Please report this, and as a workaround run it directly instead:
        cd $( [[ $what == backend ]] && echo backend || echo frontend ) && npm run dev"
    fi
    # Never let one attempt outlive the budget. `--max-time` is clamped to
    # whatever is left, so the final attempt ends exactly at the deadline
    # instead of two seconds past it.
    local attempt_timeout=$(( remaining < CURL_TIMEOUT_SECONDS ? remaining : CURL_TIMEOUT_SECONDS ))
    if curl -sS -o /dev/null --max-time "$attempt_timeout" "$url" 2>/dev/null; then
      return 0
    fi
    # Same reasoning for the pause between attempts: if the attempt consumed
    # the rest of the budget there is nothing left to sleep through, and
    # sleeping anyway is how a 90s timeout becomes 91.
    elapsed=$(( SECONDS - began ))
    (( elapsed < READY_TIMEOUT_SECONDS )) || break
    sleep 1
    elapsed=$(( SECONDS - began ))
    # A threshold rather than a modulo: a slow pass can skip over the exact
    # multiple entirely, and `elapsed % 5` would then print nothing at all.
    if (( elapsed >= next_heartbeat )); then
      log "${DIM}...still waiting for the $what — ${elapsed}s of ${READY_TIMEOUT_SECONDS}s${RESET}"
      next_heartbeat=$(( elapsed + HEARTBEAT_SECONDS ))
    fi
  done
  die "the $what did not answer on $url within ${READY_TIMEOUT_SECONDS}s.
      Its own output is above and usually names the cause. To see it without
      this script in the way:
        cd $( [[ $what == backend ]] && echo backend || echo frontend ) && npm run dev"
}

main() {
  command -v node >/dev/null || die "node is not installed. This project needs Node 22 LTS or newer."
  command -v curl >/dev/null || die "curl is not installed; this script uses it to check readiness."

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if (( node_major < 22 )); then
    warn "Node $(node -v) detected; this project targets Node 22 LTS or newer. Continuing anyway."
  fi

  require_free_port "$API_PORT" "backend"
  require_free_port "$WEB_PORT" "frontend"

  # Say up front what is coming and roughly how long, so the slow steps read as
  # expected rather than as something stuck.
  local needs_install=""
  [[ -d "$ROOT/backend/node_modules" && -d "$ROOT/frontend/node_modules" ]] || needs_install=yes
  log "starting up — 4 steps:"
  if [[ -n "$needs_install" ]]; then
    log "  ${DIM}1/4${RESET} install dependencies   ${DIM}(first run only, ~1-3 min)${RESET}"
  else
    log "  ${DIM}1/4${RESET} install dependencies   ${DIM}(already present, skipping)${RESET}"
  fi
  log "  ${DIM}2/4${RESET} apply D1 migrations    ${DIM}(~5s)${RESET}"
  log "  ${DIM}3/4${RESET} start backend          ${DIM}(~5-15s)${RESET}"
  log "  ${DIM}4/4${RESET} start frontend         ${DIM}(~5-20s)${RESET}"

  install_if_needed backend
  install_if_needed frontend

  # Must run before the backend serves traffic: the local D1 file starts empty,
  # and every query would fail on a missing table.
  local began=$SECONDS
  log "applying local D1 migrations..."
  (cd "$ROOT/backend" && npm run --silent db:migrate)
  log_done "$began" "migrations applied"

  began=$SECONDS
  log "starting backend on ${API_URL} ..."
  start_server backend
  api_pid=$started_pid
  wait_until_up "${API_URL}/health" "backend" "$api_pid"
  log_done "$began" "backend ready"
  log "  ${DIM}health: $(curl -sS "${API_URL}/health")${RESET}"

  began=$SECONDS
  log "starting frontend on ${WEB_URL} ..."
  start_server frontend
  web_pid=$started_pid
  wait_until_up "$WEB_URL" "frontend" "$web_pid"
  log_done "$began" "frontend ready"

  cat <<BANNER

  ${GREEN}${BOLD}RunProof is running.${RESET}  ${DIM}(ready in $(format_duration $(( SECONDS - STARTED_AT ))))${RESET}

    Landing page   ${BOLD}${WEB_URL}${RESET}
    Console        ${BOLD}${WEB_URL}/app${RESET}  ${DIM}(sign in first)${RESET}
    Backend API    ${BOLD}${API_URL}${RESET}

  ${BOLD}First time?${RESET} Register at ${WEB_URL}/register — that signs you in
  and drops you straight into the console. The console is empty until you
  create an incident, so start at ${WEB_URL}/app/incidents/new.

  ${BOLD}A run needs a matching runbook.${RESET} Only one ships
  (testing/runbooks/checkout-failure.json) and it triggers on service
  ${BOLD}payment-service${RESET} with signals ${BOLD}timeout${RESET} and ${BOLD}error_rate${RESET}. An incident
  filed against any other service creates fine, then fails at "start run"
  with no_matching_runbook — that is the matcher working, not a bug.

  ${DIM}The console reads NEXT_PUBLIC_API_URL, which defaults to ${API_URL} —
  the address above, so no .env file is needed for local dev.${RESET}

  ${DIM}Ctrl+C stops both.${RESET}

BANNER

  # Neither server should exit on its own; if one does, fall through and let
  # the EXIT trap stop the other. A poll rather than `wait -n`, which needs
  # bash 4.3+ (5.1+ to name specific PIDs) — stock macOS still ships 3.2, and
  # `#!/usr/bin/env bash` finds it whenever a newer bash is not on PATH.
  while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
    sleep 1
  done
  warn "one of the servers exited on its own; stopping the other."
}

main "$@"
