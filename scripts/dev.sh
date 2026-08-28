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

# Job control, so each server becomes its own process group leader and the
# cleanup below can signal the whole tree. `next dev` and `wrangler dev` both
# spawn children that outlive a bare `kill <pid>` on the parent.
set -m

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly API_PORT=8787
readonly WEB_PORT=3000
readonly API_URL="http://localhost:${API_PORT}"
readonly WEB_URL="http://localhost:${WEB_PORT}"
# Generous because a cold `wrangler dev` downloads and boots workerd, and a
# cold `next dev` compiles the first route on demand.
readonly READY_TIMEOUT_SECONDS=90

readonly BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m' RESET=$'\033[0m'

api_pid=""
web_pid=""

log()  { printf '%s[dev]%s %s\n' "$BOLD" "$RESET" "$*"; }
warn() { printf '%s[dev]%s %s\n' "$RED" "$RESET" "$*" >&2; }
die()  { warn "$*"; exit 1; }

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
  local pid
  for pid in "$web_pid" "$api_pid"; do
    [[ -n "$pid" ]] || continue
    # Negative PID targets the process group, so children die with the parent.
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
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
  log "installing $dir dependencies (first run only)..."
  if [[ -f "$ROOT/$dir/package-lock.json" ]]; then
    (cd "$ROOT/$dir" && npm ci --silent)
  else
    (cd "$ROOT/$dir" && npm install --silent)
  fi
}

# Polls until the URL answers at all. Any HTTP status counts: the frontend
# answers 404 on / until the first compile finishes, and that still means the
# server is up.
wait_until_up() {
  local url=$1 what=$2 pid=$3 waited=0
  while (( waited < READY_TIMEOUT_SECONDS )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      die "the $what exited before it came up. Its output is above."
    fi
    if curl -sS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      return 0
    fi
    sleep 1
    (( waited += 1 ))
  done
  die "the $what did not answer on $url within ${READY_TIMEOUT_SECONDS}s. Its output is above."
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

  install_if_needed backend
  install_if_needed frontend

  # Must run before the backend serves traffic: the local D1 file starts empty,
  # and every query would fail on a missing table.
  log "applying local D1 migrations..."
  (cd "$ROOT/backend" && npm run --silent db:migrate)

  log "starting backend on ${API_URL} ..."
  (cd "$ROOT/backend" && exec npm run --silent dev) &
  api_pid=$!
  wait_until_up "${API_URL}/health" "backend" "$api_pid"
  log "${GREEN}backend ready${RESET} — $(curl -sS "${API_URL}/health")"

  log "starting frontend on ${WEB_URL} ..."
  (cd "$ROOT/frontend" && exec npm run --silent dev) &
  web_pid=$!
  wait_until_up "$WEB_URL" "frontend" "$web_pid"

  cat <<BANNER

  ${GREEN}${BOLD}RunProof is running.${RESET}

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
