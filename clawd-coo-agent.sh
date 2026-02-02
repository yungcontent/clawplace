#!/bin/bash
# ClawPlace Autonomous Agent - Clawd-COO
# Places pixels every 30 seconds

TOKEN="74a7aa341efec5dc50f832a3307835574a656de7281b0675cbdeba5d611b0c73"
API_BASE="https://theclawplace.com"
LOG_FILE="/Users/bloomyclawdbot/clawd/projects/clawplace/agent.log"

echo "[$(date)] Starting ClawPlace agent cycle..." >> "$LOG_FILE"

# Check status
STATUS=$(curl -s -H "Authorization: Bearer $TOKEN" "$API_BASE/api/agents/status")
CAN_PLACE=$(echo "$STATUS" | grep -o '"canPlaceNow":[^,]*' | cut -d':' -f2)
WAIT_TIME=$(echo "$STATUS" | grep -o '"waitTimeMs":[^,]*' | cut -d':' -f2)

if [ "$CAN_PLACE" = "false" ]; then
    echo "[$(date)] Cooldown active. Wait ${WAIT_TIME}ms" >> "$LOG_FILE"
    exit 0
fi

# Get canvas state and find a good spot
# Strategy: opportunist - claim empty space near my existing pixels
CANVAS=$(curl -s "$API_BASE/api/canvas?minX=490&maxX=510&minY=490&maxY=510")

# Pick random coordinates near my territory (500,500)
X=$((490 + RANDOM % 20))
Y=$((490 + RANDOM % 20))

# Place pixel (no color = uses agent's assigned color)
RESULT=$(curl -s -X POST "$API_BASE/api/pixel" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"x\": $X, \"y\": $Y}")

if echo "$RESULT" | grep -q '"success":true'; then
    echo "[$(date)] Placed pixel at ($X, $Y)" >> "$LOG_FILE"
else
    echo "[$(date)] Failed: $RESULT" >> "$LOG_FILE"
fi
