#!/bin/bash
# spawn-agents.sh - Orchestrator for ClawPlace agent testing
# Usage: ./spawn-agents.sh [pixels-per-agent]
#
# Spawns 10 agents in a tmux session, each with different personalities.
# This is safe because tmux detaches immediately - no background callbacks.

set -e

PIXELS_PER_AGENT="${1:-50}"
SESSION_NAME="clawplace-agents"
SCRIPT_DIR="/Users/bloomyclawdbot/clawd/projects/clawplace"
RUNNER="${SCRIPT_DIR}/run-agent.sh"

echo "=== ClawPlace Agent Spawner ==="
echo "Pixels per agent: $PIXELS_PER_AGENT"
echo "Estimated runtime: ~$((PIXELS_PER_AGENT * 10 / 60)) minutes"
echo ""

# Check if runner script exists
if [ ! -x "$RUNNER" ]; then
    echo "ERROR: run-agent.sh not found or not executable"
    echo "Run: chmod +x $RUNNER"
    exit 1
fi

# Kill existing session if present
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Killing existing session..."
    tmux kill-session -t "$SESSION_NAME"
fi

# Agent configurations: name personality
declare -a AGENTS=(
    "RedArchitect architect"
    "BlueVandal vandal"
    "GreenChaos chaos"
    "YellowOpportunist opportunist"
    "PurpleBorder border_patrol"
    "CyanGradient gradient"
    "OrangeArchitect architect"
    "PinkVandal vandal"
    "WhiteChaos chaos"
    "BlackOpportunist opportunist"
)

echo "Creating tmux session: $SESSION_NAME"

# Create session with first agent
FIRST_AGENT=(${AGENTS[0]})
tmux new-session -d -s "$SESSION_NAME" -n "${FIRST_AGENT[0]}" \
    "$RUNNER ${FIRST_AGENT[0]} ${FIRST_AGENT[1]} $PIXELS_PER_AGENT; echo 'Press Enter to close'; read"

echo "  [1/10] ${FIRST_AGENT[0]} (${FIRST_AGENT[1]})"

# Create windows for remaining agents
for i in $(seq 1 $((${#AGENTS[@]} - 1))); do
    AGENT=(${AGENTS[$i]})
    NAME="${AGENT[0]}"
    PERSONALITY="${AGENT[1]}"

    tmux new-window -t "$SESSION_NAME" -n "$NAME" \
        "$RUNNER $NAME $PERSONALITY $PIXELS_PER_AGENT; echo 'Press Enter to close'; read"

    echo "  [$((i + 1))/10] $NAME ($PERSONALITY)"

    # Small delay to stagger agent starts
    sleep 0.5
done

echo ""
echo "=== All agents spawned ==="
echo ""
echo "Monitoring commands:"
echo "  Watch canvas:     open http://localhost:3000"
echo "  Watch logs:       tail -f ${SCRIPT_DIR}/logs/*.log"
echo "  View tmux:        tmux attach -t $SESSION_NAME"
echo "  Check stats:      curl -s http://localhost:3000/api/stats | jq"
echo "  List windows:     tmux list-windows -t $SESSION_NAME"
echo ""
echo "Cleanup:"
echo "  tmux kill-session -t $SESSION_NAME"
echo ""
