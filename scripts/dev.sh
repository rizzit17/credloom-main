#!/usr/bin/env bash
# Credloom local stack launcher.
#   ./scripts/dev.sh start    start chain, services and UI (deploys contracts if the chain is fresh)
#   ./scripts/dev.sh reset    wipe chain + local DB, redeploy, restart everything and seed demo data
#   ./scripts/dev.sh stop     stop everything started by this script
#   ./scripts/dev.sh status   show what is running
#   ./scripts/dev.sh test     reset to a clean chain, then run all test suites (run `reset` afterwards to restore demo data)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/.logs"; mkdir -p "$LOGS"

port_up() { (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null; }
wait_port() { for _ in $(seq 1 60); do port_up "$1" && return 0; sleep 1; done; echo "  ✗ timeout waiting for :$1 ($2)"; return 1; }

launch() { # name port dir cmd...
  local name=$1 port=$2 dir=$3; shift 3
  if port_up "$port"; then echo "  • $name already running on :$port"; return; fi
  (cd "$ROOT/$dir" && nohup "$@" > "$LOGS/$name.log" 2>&1 & echo $! > "$LOGS/$name.pid")
  wait_port "$port" "$name" && echo "  ✓ $name on :$port"
}

deploy() { (cd "$ROOT/blockchain" && npm run deploy --silent 2>&1 | tail -6); }

start() {
  echo "Starting Credloom"
  launch chain 8545 blockchain npx hardhat node
  # fresh chain has no code at the address from deployment.json
  local addr; addr=$(python3 -c "import json;print(json.load(open('$ROOT/blockchain-service/deployment.json'))['contracts']['LoanEscrow'])" 2>/dev/null || true)
  local code; code=$(curl -s -X POST -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"${addr:-0x0}\",\"latest\"]}" http://127.0.0.1:8545 | python3 -c "import sys,json;print(json.load(sys.stdin).get('result','0x'))" 2>/dev/null)
  if [ -z "$addr" ] || [ "$code" = "0x" ]; then echo "  deploying contracts…"; deploy; fi
  launch chain-service 8000 blockchain-service ./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
  launch ml 5001 mlModel ./venv/bin/uvicorn server:app --host 127.0.0.1 --port 5001
  launch backend 3001 backend node index.js
  if [ -d "$ROOT/frontend/.next" ]; then launch frontend 3000 frontend npx next start -p 3000
  else launch frontend 3000 frontend npx next dev -p 3000; fi
  echo; echo "Open http://localhost:3000   (logs in .logs/)"
}

stop() {
  for f in "$LOGS"/*.pid; do [ -f "$f" ] || continue; kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done
  for p in 8545 8000 5001 3001 3000; do lsof -ti tcp:$p -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null; done
  echo "Stopped."
}

reset() {
  stop; sleep 1
  rm -f "$ROOT/backend/data/credloom.db" "$ROOT/backend/data/credloom.db-wal" "$ROOT/backend/data/credloom.db-shm"
  start
  echo "Seeding demo data…"; (cd "$ROOT/backend" && node scripts/seed.js)
}

status() { for x in "chain:8545" "chain-service:8000" "ml:5001" "backend:3001" "frontend:3000"; do port_up "${x#*:}" && echo "  ✓ ${x%%:*}" || echo "  ✗ ${x%%:*}"; done; }

test_all() {
  echo "Tests need a clean chain (defaults are permanent on-chain). Resetting first…"
  stop; sleep 1
  rm -f "$ROOT/backend/data/credloom.db"*
  start >/dev/null
  (cd "$ROOT/blockchain" && npx hardhat test) || return 1
  (cd "$ROOT/blockchain-service" && ./venv/bin/python -m pytest tests -q) || return 1
  (cd "$ROOT/backend" && npm test --silent) || return 1
  echo; echo "All suites passed. Run './scripts/dev.sh reset' to restore the seeded demo data."
}

case "${1:-start}" in start) start;; stop) stop;; reset) reset;; status) status;; test) test_all;;
  *) echo "usage: $0 {start|reset|stop|status|test}"; exit 1;; esac
