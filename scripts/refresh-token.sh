#!/bin/bash
# Refresh Claude OAuth token via CLI.
# Install as cron: 0 */2 * * * /path/to/refresh-token.sh
# Runs every 2 hours with up to 30 min random jitter.

# Random jitter 0-1800 seconds (0-30 minutes)
JITTER=$((RANDOM % 1800))
sleep "$JITTER"

claude -p "test" --max-turns 1 > /dev/null 2>&1
