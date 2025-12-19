#!/bin/bash
# Test the support endpoint
# Note: This might fail on the actual email sending part if credentials are invalid or blocked,
# but it verifies the endpoint is reachable and attempts to send.

# Restart server to pick up changes (if needed, but node server.js was running in background)
# We might need to restart it if I haven't done so. `npm start` usually watches? No, server.js is simple.
# I will kill and restart.

pkill -f "node server.js"
nohup npm start > server.log 2>&1 &
sleep 5 # Wait for server

# Send request
curl -X POST http://localhost:3000/api/support \
     -H "Content-Type: application/json" \
     -d '{
           "username": "TestUser",
           "subject": "Test Subject",
           "email": "test@example.com",
           "message": "This is a test message from CURL."
         }'

# Check log for errors (expected if no valid credentials)
cat server.log | grep "Support Mail Error"
