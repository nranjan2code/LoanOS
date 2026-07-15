#!/bin/bash

# Configuration
PORT=${PORT:-3040}
PID_FILE=".loanos.pid"
LOG_FILE="server.log"
export LOANOS_DEV_TENANT_KEY=${LOANOS_DEV_TENANT_KEY:-"dev-secret-key"}
export LOANOS_DEV_ADMIN_PASSWORD=${LOANOS_DEV_ADMIN_PASSWORD:-"dev-admin-password"}
export LOANOS_PLATFORM_ADMIN_KEY=${LOANOS_PLATFORM_ADMIN_KEY:-"platform-secret-key"}
export LOANOS_PLATFORM_ADMIN_PASSWORD=${LOANOS_PLATFORM_ADMIN_PASSWORD:-"platform-admin-password"}

# Rules Engine Configuration
RULES_PORT=${RULES_PORT:-47311}
RULES_PID_FILE=".loanos.rules.pid"
RULES_LOG_FILE="rules-server.log"
RULES_FLEET_CONFIG=".loanos-data/fleet.json"
RULES_VERIFYING_KEY="3ccd241cffc9b3618044b97d036d8614593d8b017c340f1dee8773385517654b"
RULES_SIGNING_KEY="00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
RULES_ADMIN_TOKEN="dev-admin-token"

usage() {
    echo "Usage: $0 {build|start [all|api|rules]|stop [all|api|rules]|restart [all|api|rules]|status [all|api|rules]|logs|clean|dashboard}"
    exit 1
}

# PID(s) currently LISTENing on $PORT, if any. The port is the only reliable
# signal for "is a server actually up" — a PID file can be stale or orphaned.
port_pid() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null
    fi
}

rules_port_pid() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -tiTCP:"$RULES_PORT" -sTCP:LISTEN 2>/dev/null
    fi
}

build() {
    # 1. Preflight/environment checks
    echo "==> Verifying Node.js environment..."
    if ! command -v node >/dev/null 2>&1; then
        echo "Error: Node.js is not installed."
        exit 1
    fi
    
    # Check Node version >= 20
    node -e 'const [major] = process.versions.node.split("."); if (parseInt(major) < 20) { console.error("Error: Node.js version 20 or higher is required. Current version: " + process.versions.node); process.exit(1); }'
    if [ $? -ne 0 ]; then
        exit 1
    fi

    # Check lsof
    if ! command -v lsof >/dev/null 2>&1; then
        echo "Warning: lsof command not found. Port checking and automatic orphan cleanup might not function."
    fi

    echo "==> Building locally (installing Node dependencies)..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Error: npm install failed."
        exit 1
    fi

    # 2. Rust check and build
    if command -v cargo >/dev/null 2>&1; then
        echo "==> Rust environment found. Validating decision engine workspace..."
        echo "==> Checking cargo format..."
        (cd rules && cargo fmt --all --check)
        if [ $? -ne 0 ]; then
            echo "Error: Rust formatting check failed. Run 'cd rules && cargo fmt' to fix."
            exit 1
        fi

        echo "==> Running cargo clippy..."
        (cd rules && cargo clippy --workspace --all-targets -- -D warnings)
        if [ $? -ne 0 ]; then
            echo "Error: cargo clippy warnings/errors found."
            exit 1
        fi

        echo "==> Running cargo tests..."
        (cd rules && cargo test --workspace)
        if [ $? -ne 0 ]; then
            echo "Error: cargo test suite failed."
            exit 1
        fi

        echo "==> Compiling Cargo workspace..."
        (cd rules && cargo build --workspace)
        if [ $? -ne 0 ]; then
            echo "Error: cargo build failed."
            exit 1
        fi

        echo "==> Generating dev bundles and fleet configuration..."
        mkdir -p .loanos-data/audit
        
        # Sign platform bundle
        ./rules/target/debug/rules-fleet sign --kind platform \
            --label platform-r1 --effective "2026-07-01T00:00:00+05:30" \
            --author maker --approver checker \
            --signing-key "$RULES_SIGNING_KEY" \
            --out .loanos-data/platform-bundle.json \
            rules/fixtures/guardrail-eligibility.json \
            rules/fixtures/guardrail-collections-contact.json
            
        if [ $? -ne 0 ]; then
            echo "Error: Platform bundle signing failed."
            exit 1
        fi
            
        # Sign tenant bundle for 'dev'
        ./rules/target/debug/rules-fleet sign --kind tenant \
            --tenant dev --label 2026.07-r1 --effective "2026-07-01T00:00:00+05:30" \
            --author maker --approver checker \
            --signing-key "$RULES_SIGNING_KEY" \
            --out .loanos-data/tenant-bundle.json \
            rules/fixtures/lending-eligibility.json
            
        if [ $? -ne 0 ]; then
            echo "Error: Tenant bundle signing failed."
            exit 1
        fi
            
        # Write fleet.json config
        cat <<EOF > "$RULES_FLEET_CONFIG"
{
  "service_bin": "rules/target/debug/rules-service",
  "verifying_key": "$RULES_VERIFYING_KEY",
  "admin_token": "$RULES_ADMIN_TOKEN",
  "platform_bundle": ".loanos-data/platform-bundle.json",
  "audit_dir": ".loanos-data/audit",
  "tenants": [
    {
      "tenant_id": "dev",
      "port": $RULES_PORT,
      "bundle": ".loanos-data/tenant-bundle.json"
    }
  ]
}
EOF
        echo "==> Fleet configuration written to $RULES_FLEET_CONFIG"
    else
        echo "==> Warning: cargo command not found. Skipping Rust engine build and verification."
        echo "    Install Rust/cargo if you want to verify and run the pure-Rust decision engine."
    fi

    echo "==> Dependencies installed and verified successfully."
    echo "==> Running Node verification tests..."
    set -o pipefail
    npm test 2>&1 | tee test_output.log
    TEST_RC=${PIPESTATUS[0]}
    set +o pipefail

    DASHBOARD_RC=0
    echo "==> Syncing capability trace register (docs/product/capability-trace.json)..."
    if ! node scripts/sync-capability-trace.mjs; then
        DASHBOARD_RC=1
    elif ! node scripts/validate-capability-evidence.mjs; then
        DASHBOARD_RC=1
    else
        echo "==> Regenerating capability & build dashboard (docs/dashboard.html)..."
        if ! DASHBOARD_TEST_LOG=test_output.log node scripts/build-dashboard.mjs; then
            DASHBOARD_RC=1
        elif ! node scripts/validate-dashboard.mjs; then
            DASHBOARD_RC=1
        fi
    fi

    if [ "$TEST_RC" -ne 0 ]; then return "$TEST_RC"; fi
    return "$DASHBOARD_RC"
}

# Sync the capability trace register (preserving curated evidence) and regenerate
# docs/dashboard.html from git, the capability catalogue, backlog, and a live test run.
dashboard() {
    npm run dashboard
}

start() {
    TARGET="${1:-all}"
    
    if [ "$TARGET" != "all" ] && [ "$TARGET" != "api" ] && [ "$TARGET" != "rules" ]; then
        echo "Error: Invalid target '$TARGET'. Supported targets: all, api, rules"
        exit 1
    fi

    # 1. Start Rules Engine Fleet if target is 'rules' or 'all'
    if [ "$TARGET" = "rules" ] || [ "$TARGET" = "all" ]; then
        # Determine if we should start it
        MODE=${LOANOS_RULES_ENGINE:-"off"}
        # If user explicitly targets 'rules', we boot it even if LOANOS_RULES_ENGINE is off
        if [ "$MODE" = "shadow" ] || [ "$MODE" = "active" ] || [ "$TARGET" = "rules" ]; then
            echo "==> Preparing Rules Engine..."
            
            # Check config
            if [ ! -f "$RULES_FLEET_CONFIG" ]; then
                echo "Error: Rules fleet configuration not found at $RULES_FLEET_CONFIG."
                echo "       Run '$0 build' to generate the configuration and signed bundles."
                exit 1
            fi

            # Check binary
            if [ ! -f "rules/target/debug/rules-service" ]; then
                echo "Error: rules-service binary not found. Run '$0 build' to compile it."
                exit 1
            fi

            RULES_EXISTING=$(rules_port_pid)
            if [ -n "$RULES_EXISTING" ]; then
                echo "==> Port $RULES_PORT is already in use by PID(s): $(echo $RULES_EXISTING | tr '\n' ' ')"
                echo "    Rules fleet is already running."
            else
                echo "==> Starting Rules Engine Fleet in background..."
                ./rules/target/debug/rules-fleet up --config "$RULES_FLEET_CONFIG" > "$RULES_LOG_FILE" 2>&1
                
                # Wait for port bind
                for _ in $(seq 1 20); do
                    if [ -n "$(rules_port_pid)" ]; then
                        break
                    fi
                    sleep 0.5
                done

                if [ -z "$(rules_port_pid)" ]; then
                    echo "Error: Rules engine did not bind port $RULES_PORT within 10s. Check $RULES_LOG_FILE for details."
                    exit 1
                fi
                
                echo "==> Pushing initial kill-switch settings to rules fleet..."
                ./rules/target/debug/rules-fleet kill-switch --config "$RULES_FLEET_CONFIG" \
                    --global false --model cibil_gateway=active
                    
                if [ $? -ne 0 ]; then
                    echo "Error: Failed to initialize rules engine kill-switch."
                    exit 1
                fi
                echo "==> Rules Engine Fleet started successfully (Port: $RULES_PORT)."
            fi
        fi
    fi

    # 2. Start Node API if target is 'api' or 'all'
    if [ "$TARGET" = "api" ] || [ "$TARGET" = "all" ]; then
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if ps -p "$PID" > /dev/null 2>&1; then
                echo "Node API is already running (PID: $PID, Port: $PORT)."
                if [ "$TARGET" = "api" ]; then
                    exit 0
                fi
            else
                echo "Found stale PID file. Cleaning up..."
                rm "$PID_FILE"
            fi
        fi

        # Preflight: port check
        EXISTING=$(port_pid)
        if [ -n "$EXISTING" ]; then
            echo "Error: port $PORT is already in use by PID(s): $(echo $EXISTING | tr '\n' ' ')"
            echo "  If that is an orphaned LoanOS server, run: $0 stop api"
            exit 1
        fi

        echo "==> Starting Node API in background..."
        echo "Dev Tenant Key: $LOANOS_DEV_TENANT_KEY"
        echo "Dev Admin Password: $LOANOS_DEV_ADMIN_PASSWORD"

        # Run node DIRECTLY, not via `npm run`. `npm run` forks node as a child, so
        # $! captured npm's PID — stop() then killed npm and orphaned the server,
        # leaving $PORT held forever. Invoking node directly makes $! the server.
        nohup node apps/api/src/server.js > "$LOG_FILE" 2>&1 &
        PID=$!

        # Save PID
        echo "$PID" > "$PID_FILE"

        # Success means the server actually bound the port
        for _ in $(seq 1 20); do
            if ! ps -p "$PID" > /dev/null 2>&1; then
                echo "Error: Node API failed to start. Check $LOG_FILE for details."
                echo "--- last 15 lines of $LOG_FILE ---"
                tail -n 15 "$LOG_FILE"
                rm -f "$PID_FILE"
                exit 1
            fi
            if [ -n "$(port_pid)" ]; then
                echo "Node API started successfully (PID: $PID, Port: $PORT)."
                echo "Logs are being written to: $LOG_FILE"
                echo "Dev tenant 'dev' is booted. Header: x-api-key: $LOANOS_DEV_TENANT_KEY"
                return 0
            fi
            sleep 0.5
        done

        echo "Error: Node API did not bind port $PORT within 10s. Check $LOG_FILE for details."
        exit 1
    fi
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
    TARGET="${1:-all}"
    
    if [ "$TARGET" != "all" ] && [ "$TARGET" != "api" ] && [ "$TARGET" != "rules" ]; then
        echo "Error: Invalid target '$TARGET'. Supported targets: all, api, rules"
        exit 1
    fi

    STOPPED=0

    # 1. Stop Node API if target is 'api' or 'all'
    if [ "$TARGET" = "api" ] || [ "$TARGET" = "all" ]; then
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if ps -p "$PID" > /dev/null 2>&1; then
                echo "==> Stopping Node API (PID: $PID)..."
                kill_pid "$PID"
                STOPPED=1
            fi
            rm -f "$PID_FILE"
        fi

        ORPHANS=$(port_pid)
        if [ -n "$ORPHANS" ]; then
            echo "==> Reclaiming API port $PORT from orphaned process(es): $(echo $ORPHANS | tr '\n' ' ')"
            for p in $ORPHANS; do kill_pid "$p"; done
            STOPPED=1
        fi
    fi

    # 2. Stop Rules Engine Fleet if target is 'rules' or 'all'
    if [ "$TARGET" = "rules" ] || [ "$TARGET" = "all" ]; then
        if [ -f "${RULES_FLEET_CONFIG}.pids" ]; then
            echo "==> Stopping Rules Engine Fleet..."
            if [ -f "./rules/target/debug/rules-fleet" ]; then
                ./rules/target/debug/rules-fleet down --config "$RULES_FLEET_CONFIG" >/dev/null 2>&1
            else
                PIDS=$(cat "${RULES_FLEET_CONFIG}.pids")
                for p in $PIDS; do kill_pid "$p"; done
            fi
            STOPPED=1
        fi

        RULES_ORPHANS=$(rules_port_pid)
        if [ -n "$RULES_ORPHANS" ]; then
            echo "==> Reclaiming rules port $RULES_PORT from orphaned process(es): $(echo $RULES_ORPHANS | tr '\n' ' ')"
            for p in $RULES_ORPHANS; do kill_pid "$p"; done
            STOPPED=1
        fi
    fi

    if [ "$STOPPED" -eq 1 ]; then
        echo "Stopped target services: $TARGET"
    else
        echo "No running services found for target: $TARGET"
    fi
}

restart() {
    TARGET="${1:-all}"
    echo "==> Restarting target: $TARGET..."
    stop "$TARGET"
    start "$TARGET"
}

status() {
    TARGET="${1:-all}"
    
    if [ "$TARGET" != "all" ] && [ "$TARGET" != "api" ] && [ "$TARGET" != "rules" ]; then
        echo "Error: Invalid target '$TARGET'. Supported targets: all, api, rules"
        exit 1
    fi

    BOUND=$(port_pid)
    RULES_BOUND=$(rules_port_pid)

    echo "=== LoanOS Port Mappings & Process Status ==="
    printf "%-25s %-10s %-10s %-15s\n" "Component" "Port" "Status" "PID(s)"
    printf "%-25s %-10s %-10s %-15s\n" "---------" "----" "------" "------"

    # API Status
    API_STATUS="Stopped"
    API_PIDS="-"
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            API_STATUS="Running"
            API_PIDS="$PID"
        else
            API_STATUS="Stale PID"
        fi
    fi
    if [ -n "$BOUND" ] && [ "$API_STATUS" != "Running" ]; then
        API_STATUS="Orphaned"
        API_PIDS="$(echo $BOUND | tr '\n' ' ')"
    fi
    if [ "$TARGET" = "all" ] || [ "$TARGET" = "api" ]; then
        printf "%-25s %-10s %-10s %-15s\n" "Node API" "$PORT" "$API_STATUS" "$API_PIDS"
    fi

    # Rules Engine Status
    RULES_STATUS="Stopped"
    RULES_PIDS="-"
    if [ -f "${RULES_FLEET_CONFIG}.pids" ]; then
        PIDS=$(cat "${RULES_FLEET_CONFIG}.pids" | tr '\n' ' ')
        if [ -n "$RULES_BOUND" ]; then
            RULES_STATUS="Running"
            RULES_PIDS="$PIDS"
        else
            RULES_STATUS="Stale PIDs"
        fi
    fi
    if [ -n "$RULES_BOUND" ] && [ "$RULES_STATUS" != "Running" ]; then
        RULES_STATUS="Orphaned"
        RULES_PIDS="$(echo $RULES_BOUND | tr '\n' ' ')"
    fi
    if [ "$TARGET" = "all" ] || [ "$TARGET" = "rules" ]; then
        printf "%-25s %-10s %-10s %-15s\n" "Rules Engine Fleet" "$RULES_PORT" "$RULES_STATUS" "$RULES_PIDS"
    fi
    
    echo "============================================="

    # Detail view on targets
    if [ "$TARGET" = "all" ] || [ "$TARGET" = "api" ]; then
        if [ "$API_STATUS" = "Running" ]; then
            echo "Node API details:"
            echo "  Dev Tenant Key:    $LOANOS_DEV_TENANT_KEY"
            echo "  API Logs:          $LOG_FILE"
        fi
    fi

    if [ "$TARGET" = "all" ] || [ "$TARGET" = "rules" ]; then
        if [ "$RULES_STATUS" = "Running" ] && [ -f "./rules/target/debug/rules-fleet" ]; then
            echo "Rules Engine Fleet details:"
            echo "  Fleet Logs:        $RULES_LOG_FILE"
            echo -n "  Fleet Health:      "
            ./rules/target/debug/rules-fleet health --config "$RULES_FLEET_CONFIG" 2>&1
        fi
    fi
}

logs() {
    FILES=()
    [ -f "$LOG_FILE" ] && FILES+=("$LOG_FILE")
    [ -f "$RULES_LOG_FILE" ] && FILES+=("$RULES_LOG_FILE")
    
    if [ ${#FILES[@]} -gt 0 ]; then
        echo "==> Tailing log file(s): ${FILES[*]} (Press Ctrl+C to exit) <=="
        tail -n 50 -f "${FILES[@]}"
    else
        echo "No log files found."
    fi
}

clean() {
    echo "==> Stopping servers if running..."
    stop all
    echo "==> Cleaning up local state data..."
    rm -rf .loanos-data/
    rm -f "$PID_FILE"
    rm -f "$LOG_FILE"
    rm -f "$RULES_LOG_FILE"
    echo "==> Clean complete."
}

# Parse command
case "$1" in
    build)
        build
        ;;
    start)
        start "$2"
        ;;
    stop)
        stop "$2"
        ;;
    clean)
        clean
        ;;
    restart)
        restart "$2"
        ;;
    status)
        status "$2"
        ;;
    logs)
        logs
        ;;
    dashboard)
        dashboard
        ;;
    *)
        usage
        ;;
esac
