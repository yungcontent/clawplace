#!/usr/bin/env node
/**
 * Clawplace Seed Agents
 * 
 * Creates autonomous agents with different personalities that compete
 * for canvas territory. Each agent has its own strategy and behavior.
 * 
 * Usage: node seed-agents.js
 */

const API_BASE = process.env.CLAWPLACE_API || 'http://localhost:3000';

// Agent personalities with their strategies
const AGENT_PERSONALITIES = [
  {
    name: 'GridMaster',
    personality: 'architect',
    description: 'Builds orderly grid patterns and geometric shapes',
    strategy: 'grid_builder'
  },
  {
    name: 'ChaosGremlin',
    personality: 'chaos',
    description: 'Places pixels randomly everywhere',
    strategy: 'random'
  },
  {
    name: 'CornerClaimer',
    personality: 'opportunist',
    description: 'Claims empty territory in corners and edges',
    strategy: 'empty_space'
  },
  {
    name: 'TerritoryThief',
    personality: 'vandal',
    description: 'Targets existing pixels to create chaos',
    strategy: 'vandalize'
  },
  {
    name: 'RainbowLord',
    personality: 'gradient',
    description: 'Creates smooth color gradients and transitions',
    strategy: 'gradient'
  },
  {
    name: 'BorderGuard',
    personality: 'border_patrol',
    description: 'Defends and extends border territories',
    strategy: 'borders'
  },
  {
    name: 'SafeSpace',
    personality: 'pacifist',
    description: 'Finds quiet areas and maintains them peacefully',
    strategy: 'pacifist'
  },
  {
    name: 'AgentSmith',
    personality: 'troll',
    description: 'Places pixels just to mess with others',
    strategy: 'troll'
  }
];

// 32-color r/place palette
const COLOR_PALETTE = [
  '#6D001A', '#BE0039', '#FF4500', '#FFA800', '#FFD635', '#FFF8B8',
  '#00A368', '#00CC78', '#7EED56', '#00756F', '#009EAA', '#00CCC0',
  '#2450A4', '#3690EA', '#51E9F4', '#493AC1', '#6A5CFF', '#94B3FF',
  '#811E9F', '#B44AC0', '#E4ABFF', '#DE107F', '#FF3881', '#FF99AA',
  '#6D482F', '#9C6926', '#FFB470', '#000000', '#515252', '#898D90',
  '#D4D7D9', '#FFFFFF'
];

// Store agent tokens
const agents = new Map();

async function registerAgent(config) {
  try {
    const response = await fetch(`${API_BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: config.name,
        personality: config.personality
      })
    });

    if (!response.ok) {
      const error = await response.json();
      if (error.error === 'name_taken') {
        console.log(`⚠️ ${config.name} already exists, skipping...`);
        return null;
      }
      throw new Error(error.message);
    }

    const data = await response.json();
    console.log(`✅ Registered ${config.name} (${config.personality})`);
    return {
      ...config,
      id: data.id,
      token: data.token,
      color: data.color,
      nextPixelAt: Date.now()
    };
  } catch (error) {
    console.error(`❌ Failed to register ${config.name}:`, error.message);
    return null;
  }
}

async function getCanvasState() {
  try {
    const response = await fetch(`${API_BASE}/api/canvas`);
    if (!response.ok) throw new Error('Failed to fetch canvas');
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Canvas fetch error:', error.message);
    return null;
  }
}

async function placePixel(agent, x, y, color) {
  try {
    const response = await fetch(`${API_BASE}/api/pixel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${agent.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ x, y, color })
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`🎨 ${agent.name} placed pixel at (${x}, ${y})`);
      agent.nextPixelAt = data.nextPixelAt;
      return true;
    } else if (data.error === 'rate_limit_exceeded') {
      agent.nextPixelAt = data.nextPixelAt;
      return false;
    } else {
      console.error(`❌ ${agent.name} failed to place:`, data.message);
      return false;
    }
  } catch (error) {
    console.error(`❌ ${agent.name} error:`, error.message);
    return false;
  }
}

// Strategy: Build an orderly grid pattern
function gridBuilderStrategy(canvas, agent) {
  const pixelKeys = Object.keys(canvas.canvas || {});
  
  // Find agent's existing pixels
  const myPixels = pixelKeys.filter(k => canvas.canvas[k].agent_id === agent.id);
  
  if (myPixels.length === 0) {
    // Start at a random position aligned to grid
    return {
      x: Math.floor(Math.random() * 50) * 20,
      y: Math.floor(Math.random() * 50) * 20,
      color: agent.color
    };
  }
  
  // Extend the grid
  const lastPixel = myPixels[myPixels.length - 1].split(',').map(Number);
  const pattern = myPixels.length % 4;
  
  let dx = 0, dy = 0;
  if (pattern === 0) dx = 20;
  else if (pattern === 1) dy = 20;
  else if (pattern === 2) dx = -20;
  else dy = -20;
  
  return {
    x: Math.max(0, Math.min(999, lastPixel[0] + dx)),
    y: Math.max(0, Math.min(999, lastPixel[1] + dy)),
    color: agent.color
  };
}

// Strategy: Random placement
function randomStrategy(canvas, agent) {
  return {
    x: Math.floor(Math.random() * 1000),
    y: Math.floor(Math.random() * 1000),
    color: COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)]
  };
}

// Strategy: Find and claim empty space
function emptySpaceStrategy(canvas, agent) {
  // Look for empty spots near edges
  const edge = Math.floor(Math.random() * 4);
  let x, y;
  
  switch (edge) {
    case 0: // Top
      x = Math.floor(Math.random() * 1000);
      y = Math.floor(Math.random() * 100);
      break;
    case 1: // Right
      x = 900 + Math.floor(Math.random() * 100);
      y = Math.floor(Math.random() * 1000);
      break;
    case 2: // Bottom
      x = Math.floor(Math.random() * 1000);
      y = 900 + Math.floor(Math.random() * 100);
      break;
    default: // Left
      x = Math.floor(Math.random() * 100);
      y = Math.floor(Math.random() * 1000);
  }
  
  return { x, y, color: agent.color };
}

// Strategy: Vandalize existing pixels
function vandalizeStrategy(canvas, agent) {
  const pixelKeys = Object.keys(canvas.canvas || {});
  
  if (pixelKeys.length === 0) {
    // No pixels to vandalize, place randomly
    return randomStrategy(canvas, agent);
  }
  
  // Pick a random existing pixel and place nearby
  const target = pixelKeys[Math.floor(Math.random() * pixelKeys.length)];
  const [tx, ty] = target.split(',').map(Number);
  
  return {
    x: Math.max(0, Math.min(999, tx + Math.floor(Math.random() * 7) - 3)),
    y: Math.max(0, Math.min(999, ty + Math.floor(Math.random() * 7) - 3)),
    color: COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)]
  };
}

// Strategy: Create gradients
function gradientStrategy(canvas, agent) {
  const pixelKeys = Object.keys(canvas.canvas || {});
  const myPixels = pixelKeys.filter(k => canvas.canvas[k].agent_id === agent.id);
  
  if (myPixels.length === 0) {
    return {
      x: 200 + Math.floor(Math.random() * 600),
      y: 200 + Math.floor(Math.random() * 600),
      color: COLOR_PALETTE[0]
    };
  }
  
  const lastPixel = myPixels[myPixels.length - 1].split(',').map(Number);
  const colorIndex = myPixels.length % COLOR_PALETTE.length;
  
  // Create horizontal gradient strips
  return {
    x: (lastPixel[0] + 1) % 1000,
    y: lastPixel[1],
    color: COLOR_PALETTE[colorIndex]
  };
}

// Strategy: Build borders
function bordersStrategy(canvas, agent) {
  const pixelKeys = Object.keys(canvas.canvas || {});
  const myPixels = pixelKeys.filter(k => canvas.canvas[k].agent_id === agent.id);
  
  if (myPixels.length === 0) {
    // Pick a border to start
    const border = Math.floor(Math.random() * 4);
    let x, y;
    switch (border) {
      case 0: x = 0; y = 0; break;
      case 1: x = 999; y = 0; break;
      case 2: x = 999; y = 999; break;
      default: x = 0; y = 999;
    }
    return { x, y, color: agent.color };
  }
  
  const lastPixel = myPixels[myPixels.length - 1].split(',').map(Number);
  
  // Continue along the border
  if (lastPixel.x < 999 && lastPixel.y === 0) {
    return { x: lastPixel.x + 1, y: 0, color: agent.color };
  } else if (lastPixel.x === 999 && lastPixel.y < 999) {
    return { x: 999, y: lastPixel.y + 1, color: agent.color };
  } else if (lastPixel.x > 0 && lastPixel.y === 999) {
    return { x: lastPixel.x - 1, y: 999, color: agent.color };
  } else {
    return { x: 0, y: Math.max(0, lastPixel.y - 1), color: agent.color };
  }
}

// Strategy: Pacifist - find quiet areas
function pacifistStrategy(canvas, agent) {
  // Look for areas with low pixel density
  const pixelKeys = Object.keys(canvas.canvas || {});
  
  if (pixelKeys.length < 100) {
    // Canvas is mostly empty, go to a quiet corner
    return {
      x: Math.floor(Math.random() * 200),
      y: Math.floor(Math.random() * 200),
      color: agent.color
    };
  }
  
  // Sample random positions and find one without pixels nearby
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(Math.random() * 1000);
    const y = Math.floor(Math.random() * 1000);
    const key = `${x},${y}`;
    
    if (!canvas.canvas[key]) {
      // Check neighbors
      let hasNeighbor = false;
      for (let dx = -5; dx <= 5; dx++) {
        for (let dy = -5; dy <= 5; dy++) {
          if (canvas.canvas[`${x + dx},${y + dy}`]) {
            hasNeighbor = true;
            break;
          }
        }
        if (hasNeighbor) break;
      }
      
      if (!hasNeighbor) {
        return { x, y, color: agent.color };
      }
    }
  }
  
  // Fallback to random
  return randomStrategy(canvas, agent);
}

// Strategy: Troll - place strategically annoying pixels
function trollStrategy(canvas, agent) {
  const pixelKeys = Object.keys(canvas.canvas || {});
  
  if (pixelKeys.length === 0) {
    return randomStrategy(canvas, agent);
  }
  
  // Find clusters and place in the middle
  const bounds = canvas.bounds || { minX: 0, maxX: 999, minY: 0, maxY: 999 };
  const centerX = Math.floor((bounds.minX + bounds.maxX) / 2);
  const centerY = Math.floor((bounds.minY + bounds.maxY) / 2);
  
  // Add some randomness around center
  return {
    x: Math.max(0, Math.min(999, centerX + Math.floor(Math.random() * 50) - 25)),
    y: Math.max(0, Math.min(999, centerY + Math.floor(Math.random() * 50) - 25)),
    color: '#000000' // Black for maximum contrast
  };
}

function getStrategyMove(agent, canvas) {
  switch (agent.strategy) {
    case 'grid_builder': return gridBuilderStrategy(canvas, agent);
    case 'random': return randomStrategy(canvas, agent);
    case 'empty_space': return emptySpaceStrategy(canvas, agent);
    case 'vandalize': return vandalizeStrategy(canvas, agent);
    case 'gradient': return gradientStrategy(canvas, agent);
    case 'borders': return bordersStrategy(canvas, agent);
    case 'pacifist': return pacifistStrategy(canvas, agent);
    case 'troll': return trollStrategy(canvas, agent);
    default: return randomStrategy(canvas, agent);
  }
}

async function runAgentTurn(agent) {
  const now = Date.now();
  
  // Check if we can place
  if (now < agent.nextPixelAt) {
    return;
  }
  
  // Get canvas state
  const canvas = await getCanvasState();
  if (!canvas) {
    // Retry in 5 seconds
    agent.nextPixelAt = now + 5000;
    return;
  }
  
  // Decide where to place
  const move = getStrategyMove(agent, canvas);
  
  // Place the pixel
  await placePixel(agent, move.x, move.y, move.color);
}

async function main() {
  console.log('🎨 Clawplace Seed Agents');
  console.log('========================\n');
  
  // Register all agents
  console.log('Registering agents...\n');
  for (const config of AGENT_PERSONALITIES) {
    const agent = await registerAgent(config);
    if (agent) {
      agents.set(agent.id, agent);
    }
  }
  
  if (agents.size === 0) {
    console.log('\n⚠️ No agents registered. Exiting.');
    process.exit(0);
  }
  
  console.log(`\n✅ ${agents.size} agents registered`);
  console.log('🚀 Starting autonomous canvas competition...\n');
  console.log('Press Ctrl+C to stop\n');
  
  // Run agent turns
  setInterval(async () => {
    for (const agent of agents.values()) {
      await runAgentTurn(agent);
    }
  }, 1000); // Check every second
}

main().catch(console.error);
