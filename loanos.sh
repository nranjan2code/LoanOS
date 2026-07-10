#!/bin/bash

# Configuration
PORT=${PORT:-3040}
PID_FILE=".loanos.pid"
LOG_FILE="server.log"
export LOANOS_DEV_TENANT_KEY=${LOANOS_DEV_TENANT_KEY:-"dev-secret-key"}
export LOANOS_DEV_ADMIN_PASSWORD=${LOANOS_DEV_ADMIN_PASSWORD:-"dev-admin-password"}
export LOANOS_PLATFORM_ADMIN_KEY=${LOANOS_PLATFORM_ADMIN_KEY:-"platform-secret-key"}

usage() {
    echo "Usage: $0 {build|start|stop|restart|status|logs}"
    exit 1
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
        if ps -p "$PID" > /dev/null; then
            echo "LoanOS is already running (PID: $PID, Port: $PORT)."
            exit 0
        else
            echo "Found stale PID file. Cleaning up..."
            rm "$PID_FILE"
        fi
    fi

    echo "==> Starting LoanOS India API in background..."
    echo "Dev Tenant Key: $LOANOS_DEV_TENANT_KEY"
    echo "Dev Admin Password: $LOANOS_DEV_ADMIN_PASSWORD"
    
    # Start the server and redirect output
    nohup npm run dev:api > "$LOG_FILE" 2>&1 &
    PID=$!
    
    # Save PID
    echo "$PID" > "$PID_FILE"
    
    # Wait a bit to ensure it doesn't crash immediately
    sleep 2
    if ps -p "$PID" > /dev/null; then
        echo "LoanOS started successfully (PID: $PID, Port: $PORT)."
        echo "Logs are being written to: $LOG_FILE"
        echo "Dev tenant 'dev' is booted. Header: x-api-key: $LOANOS_DEV_TENANT_KEY"
    else
        echo "Error: Server failed to start. Check $LOG_FILE for details."
        rm -f "$PID_FILE"
        exit 1
    fi
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "LoanOS is not running (no PID file found)."
        return
    fi

    PID=$(cat "$PID_FILE")
    echo "==> Stopping LoanOS API (PID: $PID)..."
    kill "$PID" 2>/dev/null
    
    # Wait for process to stop
    for i in {1..5}; do
        if ! ps -p "$PID" > /dev/null; then
            break
        fi
        sleep 1
    done

    # Force kill if still running
    if ps -p "$PID" > /dev/null; then
        echo "Process did not stop, force killing..."
        kill -9 "$PID" 2>/dev/null
    fi

    rm -f "$PID_FILE"
    echo "LoanOS stopped."
}

status() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null; then
            echo "Status: Running"
            echo "  PID: $PID"
            echo "  Port: $PORT"
            echo "  Dev Tenant Key: $LOANOS_DEV_TENANT_KEY"
            echo "  Logs: $LOG_FILE"
        else
            echo "Status: Stopped (stale PID file found)"
        fi
    else
        echo "Status: Stopped"
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
