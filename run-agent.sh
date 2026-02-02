#!/bin/bash
# run-agent.sh - Single agent runner for ClawPlace
# Usage: ./run-agent.sh <agent-name> <personality> <max-pixels>

set -e

AGENT_NAME="${1:-TestAgent}"
PERSONALITY="${2:-chaos}"
MAX_PIXELS="${3:-10}"
API_BASE="http://localhost:3000/api"
LOGFILE="/Users/bloomyclawdbot/clawd/projects/clawplace/logs/${AGENT_NAME}.log"

log() {
    echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOGFILE"
}

# Colors available (hex codes)
HEX_COLORS=("#FF0000" "#0000FF" "#00FF00" "#FFFF00" "#800080" "#00FFFF" "#FFA500" "#FFC0CB" "#FFFFFF" "#000000")
COLOR_NAMES=("red" "blue" "green" "yellow" "purple" "cyan" "orange" "pink" "white" "black")

# Convert color name to hex
name_to_hex() {
    case "$1" in
        red) echo "#FF0000" ;;
        blue) echo "#0000FF" ;;
        green) echo "#00FF00" ;;
        yellow) echo "#FFFF00" ;;
        purple) echo "#800080" ;;
        cyan) echo "#00FFFF" ;;
        orange) echo "#FFA500" ;;
        pink) echo "#FFC0CB" ;;
        white) echo "#FFFFFF" ;;
        black) echo "#000000" ;;
        *) echo "#FF0000" ;;
    esac
}

# Get a random color (returns hex)
random_color() {
    echo "${HEX_COLORS[$((RANDOM % ${#HEX_COLORS[@]}))]}"
}

# Get coordinates based on personality
get_coords() {
    local personality="$1"
    local pixel_num="$2"

    case "$personality" in
        architect)
            # Grid pattern from origin
            local x=$((pixel_num % 20 - 10))
            local y=$((pixel_num / 20 - 10))
            echo "$x $y"
            ;;
        vandal)
            # Attack center area (-10 to 10)
            local x=$((RANDOM % 21 - 10))
            local y=$((RANDOM % 21 - 10))
            echo "$x $y"
            ;;
        chaos)
            # Random everywhere (-50 to 50)
            local x=$((RANDOM % 101 - 50))
            local y=$((RANDOM % 101 - 50))
            echo "$x $y"
            ;;
        opportunist)
            # Spiral outward
            local angle=$((pixel_num * 37))  # Golden angle approximation
            local radius=$((pixel_num / 3))
            # Bash doesn't do floats, so approximate
            local x=$(( (radius * (pixel_num % 2 == 0 ? 1 : -1)) + (pixel_num % 7 - 3) ))
            local y=$(( (radius * (pixel_num % 3 == 0 ? 1 : -1)) + (pixel_num % 5 - 2) ))
            echo "$x $y"
            ;;
        border_patrol)
            # Create perimeter at distance 25
            local side=$((pixel_num % 4))
            local pos=$((pixel_num / 4 % 50 - 25))
            case "$side" in
                0) echo "$pos -25" ;;  # Top
                1) echo "25 $pos" ;;   # Right
                2) echo "$pos 25" ;;   # Bottom
                3) echo "-25 $pos" ;;  # Left
            esac
            ;;
        gradient)
            # Diagonal patterns
            local x=$((pixel_num % 30 - 15))
            local y=$((x + (pixel_num / 30 * 3)))
            echo "$x $y"
            ;;
        *)
            # Default to random
            local x=$((RANDOM % 101 - 50))
            local y=$((RANDOM % 101 - 50))
            echo "$x $y"
            ;;
    esac
}

# Get color based on agent name (extract color from name, returns hex)
get_agent_color() {
    local name="$1"
    name_lower=$(echo "$name" | tr '[:upper:]' '[:lower:]')

    for color in "${COLOR_NAMES[@]}"; do
        if [[ "$name_lower" == *"$color"* ]]; then
            name_to_hex "$color"
            return
        fi
    done

    # Default to random if no color in name
    random_color
}

log "=== Starting agent: $AGENT_NAME ==="
log "Personality: $PERSONALITY"
log "Max pixels: $MAX_PIXELS"

# Register with the API to get a bearer token
log "Registering with API..."
REGISTER_RESPONSE=$(curl -s -X POST "${API_BASE}/agents" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${AGENT_NAME}\"}")

TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    log "ERROR: Failed to register. Response: $REGISTER_RESPONSE"
    exit 1
fi

log "Registered successfully. Token: ${TOKEN:0:8}..."

# Get agent's preferred color
AGENT_COLOR=$(get_agent_color "$AGENT_NAME")
log "Agent color: $AGENT_COLOR"

# Main loop - place pixels
PIXELS_PLACED=0
COOLDOWN=1  # 1 second between placements (test mode)

while true; do
    # Get coordinates based on personality
    read -r X Y <<< $(get_coords "$PERSONALITY" "$PIXELS_PLACED")

    # Occasionally use a different color for variety (20% chance)
    if [ $((RANDOM % 5)) -eq 0 ]; then
        COLOR=$(random_color)
    else
        COLOR="$AGENT_COLOR"
    fi

    log "Placing pixel #$((PIXELS_PLACED + 1)) at ($X, $Y) with color $COLOR"

    # Place the pixel
    RESPONSE=$(curl -s -X POST "${API_BASE}/pixel" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${TOKEN}" \
        -d "{\"x\": ${X}, \"y\": ${Y}, \"color\": \"${COLOR}\"}")

    # Check response
    if echo "$RESPONSE" | grep -q '"success":true'; then
        log "  ✓ Pixel placed successfully"
        PIXELS_PLACED=$((PIXELS_PLACED + 1))
    elif echo "$RESPONSE" | grep -q 'cooldown'; then
        REMAINING=$(echo "$RESPONSE" | grep -o '"remaining":[0-9]*' | cut -d':' -f2)
        log "  ⏳ Cooldown active, waiting ${REMAINING:-10}s..."
        sleep "${REMAINING:-10}"
        continue  # Retry without incrementing
    else
        log "  ✗ Error: $RESPONSE"
    fi

    # Wait for cooldown before next pixel
    log "  Waiting ${COOLDOWN}s for cooldown..."
    sleep $COOLDOWN
done
