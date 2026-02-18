#!/bin/bash
echo "🚀 Starting Secure Messages Backend (Hybrid Mode)..."

# 1. Prepare Tor Config
echo "🧅 Generating Tor Configuration..."
node scripts/prepare_tor.js

# 2. Find Tor Executable
TOR_BIN=""

if command -v tor &> /dev/null; then
    echo "   Tor found in PATH."
    TOR_BIN="tor"
elif [ -x "/usr/bin/tor" ]; then
    echo "   Tor found at /usr/bin/tor."
    TOR_BIN="/usr/bin/tor"
elif [ -x "/usr/sbin/tor" ]; then
    echo "   Tor found at /usr/sbin/tor."
    TOR_BIN="/usr/sbin/tor"
elif [ -x "/bin/tor" ]; then
    echo "   Tor found at /bin/tor."
    TOR_BIN="/bin/tor"
elif [ -x "/usr/local/bin/tor" ]; then
    echo "   Tor found at /usr/local/bin/tor."
    TOR_BIN="/usr/local/bin/tor"
else
    echo "⚠️ Tor not found in PATH or standard locations."
fi

# 3. Start Tor in Background
if [ -n "$TOR_BIN" ]; then
    echo "🧅 Starting Tor Process ($TOR_BIN)..."

    # Resolve torrc path using Node to match torManager logic exactly
    TORRC_PATH=$(node -e 'console.log(require("path").join(process.env.DATA_PATH || require("path").join(process.cwd(), "data"), "tor", "torrc"))')

    echo "   Using torrc: $TORRC_PATH"

    # Check if file exists before starting
    if [ -f "$TORRC_PATH" ]; then
        "$TOR_BIN" -f "$TORRC_PATH" &
        TOR_PID=$!
        echo "   Tor started with PID $TOR_PID"
        # Tell Node that Tor is already running
        export TOR_MANAGED_EXTERNALLY=true
    else
        echo "❌ torrc not found at $TORRC_PATH"
    fi
else
    echo "⚠️ Tor executable not found. Skipping external start. Node process will attempt to find and start it internally."
fi

# 4. Start Node Server
echo "🚀 Starting Node Server..."
node server.js
