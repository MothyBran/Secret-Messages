#!/bin/bash
echo "🚀 Starting Secure Messages Backend (Hybrid Mode)..."

# 1. Prepare Tor Config
echo "🧅 Generating Tor Configuration..."
node scripts/prepare_tor.js

# 2. Start Tor in Background
echo "🧅 Starting Tor Process..."
if command -v tor &> /dev/null; then
    # Resolve torrc path using Node to match torManager logic exactly
    TORRC_PATH=$(node -e 'console.log(require("path").join(process.env.DATA_PATH || require("path").join(process.cwd(), "data"), "tor", "torrc"))')

    echo "   Using torrc: $TORRC_PATH"

    # Check if file exists before starting
    if [ -f "$TORRC_PATH" ]; then
        tor -f "$TORRC_PATH" &
        TOR_PID=$!
        echo "   Tor started with PID $TOR_PID"
    else
        echo "❌ torrc not found at $TORRC_PATH"
    fi
else
    echo "⚠️ Tor command not found. Skipping Tor start (App will run in Clearweb only)."
fi

# 3. Start Node Server
echo "🚀 Starting Node Server..."
# Pass flag to prevent double-spawning
export TOR_MANAGED_EXTERNALLY=true
node server.js
