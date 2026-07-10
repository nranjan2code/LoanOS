#!/bin/bash

# Configuration
PORT=${PORT:-3040}
PID_FILE=".loanos.pid"
LOG_FILE="server.log"
export LOANOS_DEV_TENANT_KEY=${LOANOS_DEV_TENANT_KEY:-"dev-secret-key"}
export LOANOS_DEV_ADMIN_PASSWORD=${LOANOS_DEV_ADMIN_PASSWORD:-"dev-admin-password"}
export LOANOS_PLATFORM_ADMIN_KEY=${LOANOS_PLATFORM_ADMIN_KEY:-"platform-secret-key"}
export LOANOS_PLATFORM_ADMIN_PASSWORD=${LOANOS_PLATFORM_ADMIN_PASSWORD:-"platform-admin-password"}

usage() {
    echo "Usage: $0 {build|start|stop|restart|status|logs|clean}"
    exit 1
}

# PID(s) currently LISTENing on $PORT, if any. The port is the only reliable
# signal for "is a server actually up" — a PID file can be stale or orphaned.
port_pid() {
    lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null
}

build() {
    echo "==> Building locally (installing dependencies)..."
    npm install
    if [ $? -eq 0 ]; then
        echo "==> Dependencies installed successfully."
        echo "==> Running verification tests..."
        npm test
    else
        echo "Error: Build failed during npm install."
        exit 1
    fi
}

start() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "LoanOS is already running (PID: $PID, Port: $PORT)."
            exit 0
        else
            echo "Found stale PID file. Cleaning up..."
            rm "$PID_FILE"
        fi
    fi

    # Preflight: something already holding $PORT (typically an orphaned server)
    # makes node die with EADDRINUSE, which used to surface as a misleading
    # "Server failed to start". Name the real holder instead.
    EXISTING=$(port_pid)
    if [ -n "$EXISTING" ]; then
        echo "Error: port $PORT is already in use by PID(s): $(echo $EXISTING | tr '\n' ' ')"
        echo "  If that is an orphaned LoanOS server, run: $0 stop"
        exit 1
    fi

    echo "==> Starting LoanOS India API in background..."
    echo "Dev Tenant Key: $LOANOS_DEV_TENANT_KEY"
    echo "Dev Admin Password: $LOANOS_DEV_ADMIN_PASSWORD"

    # Run node DIRECTLY, not via `npm run`. `npm run` forks node as a child, so
    # $! captured npm's PID — stop() then killed npm and orphaned the server,
    # leaving $PORT held forever. Invoking node directly makes $! the server.
    nohup node apps/api/src/server.js > "$LOG_FILE" 2>&1 &
    PID=$!

    # Save PID
    echo "$PID" > "$PID_FILE"

    # Success means the server actually bound the port — not merely that the
    # process survived a fixed sleep.
    for _ in $(seq 1 20); do
        if ! ps -p "$PID" > /dev/null 2>&1; then
            echo "Error: Server failed to start. Check $LOG_FILE for details."
            echo "--- last 15 lines of $LOG_FILE ---"
            tail -n 15 "$LOG_FILE"
            rm -f "$PID_FILE"
            exit 1
        fi
        if [ -n "$(port_pid)" ]; then
            echo "LoanOS started successfully (PID: $PID, Port: $PORT)."
            echo "Logs are being written to: $LOG_FILE"
            echo "Dev tenant 'dev' is booted. Header: x-api-key: $LOANOS_DEV_TENANT_KEY"
            return 0
        fi
        sleep 0.5
    done

    echo "Error: server did not bind port $PORT within 10s. Check $LOG_FILE for details."
    exit 1
}

# Send TERM, wait, then KILL. Returns once the pid is gone.
kill_pid() {
    _pid="$1"
    kill "$_pid" 2>/dev/null
    for _ in $(seq 1 5); do
        ps -p "$_pid" > /dev/null 2>&1 || return 0
        sleep 1
    done
    echo "PID $_pid did not stop, force killing..."
    kill -9 "$_pid" 2>/dev/null
}

stop() {
    STOPPED=0

    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "==> Stopping LoanOS API (PID: $PID)..."
            kill_pid "$PID"
            STOPPED=1
        fi
        rm -f "$PID_FILE"
    fi

    # Reclaim the port even with no/stale PID file. Previously an orphaned
    # server held $PORT while stop() reported "not running", so every later
    # start died with EADDRINUSE and there was no way out via this script.
    ORPHANS=$(port_pid)
    if [ -n "$ORPHANS" ]; then
        echo "==> Reclaiming port $PORT from orphaned process(es): $(echo $ORPHANS | tr '\n' ' ')"
        for p in $ORPHANS; do kill_pid "$p"; done
        STOPPED=1
    fi

    if [ "$STOPPED" -eq 1 ]; then
        echo "LoanOS stopped."
    else
        echo "LoanOS is not running."
    fi
}

status() {
    BOUND=$(port_pid)

    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "Status: Running"
            echo "  PID: $PID"
            echo "  Port: $PORT"
            echo "  Dev Tenant Key: $LOANOS_DEV_TENANT_KEY"
            echo "  Logs: $LOG_FILE"
            return
        fi
        echo "Status: Stopped (stale PID file found)"
    else
        echo "Status: Stopped"
    fi

    # Tracked process is gone but the port is still held: the orphan case.
    if [ -n "$BOUND" ]; then
        echo "  WARNING: port $PORT is still held by PID(s): $(echo $BOUND | tr '\n' ' ')"
        echo "  Run '$0 stop' to reclaim it."
    fi
}

logs() {
    if [ -f "$LOG_FILE" ]; then
        echo "==> Tailing server.log (Press Ctrl+C to exit) <=="
        tail -n 50 -f "$LOG_FILE"
    else
        echo "No log file found at $LOG_FILE"
    fi
}

clean() {
    echo "==> Stopping server if running..."
    stop
    echo "==> Cleaning up local state data..."
    rm -rf .loanos-data/
    rm -f "$PID_FILE"
    rm -f "$LOG_FILE"
    echo "==> Clean complete."
}

# Parse command
case "$1" in
    build)
        build
        ;;
    start)
        start
        ;;
    stop)
        stop
        ;;
    clean)
        clean
        ;;
    restart)
        stop
        start
        ;;
    status)
        status
        ;;
    logs)
        logs
        ;;
    *)
        usage
        ;;
esac
