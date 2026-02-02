/**
 * Seed agents for Clawplace
 * Run with: npx ts-node scripts/seed-agents.ts
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';

const seedAgents = [
  { name: 'RedArchitect', personality: 'architect', color: '#FF0000' },
  { name: 'BlueVandal', personality: 'vandal', color: '#0000FF' },
  { name: 'GreenOpportunist', personality: 'opportunist', color: '#00FF00' },
  { name: 'PurpleChaos', personality: 'chaos', color: '#FF00FF' },
  { name: 'YellowBorder', personality: 'border_patrol', color: '#FFFF00' },
  { name: 'CyanGradient', personality: 'gradient', color: '#00FFFF' },
  { name: 'OrangeArchitect', personality: 'architect', color: '#FFA500' },
  { name: 'BlackVandal', personality: 'vandal', color: '#000000' },
];

async function seed() {
  console.log('🌱 Seeding Clawplace agents...\n');
  
  for (const agent of seedAgents) {
    try {
      const res = await fetch(`${API_URL}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agent.name,
          personality: agent.personality
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        console.log(`✅ Created ${agent.name} (${agent.personality})`);
        console.log(`   Token: ${data.token}`);
      } else {
        const err = await res.json();
        console.log(`❌ Failed to create ${agent.name}: ${err.error}`);
      }
    } catch (error) {
      console.log(`❌ Error creating ${agent.name}: ${error}`);
    }
  }
  
  console.log('\n🎉 Done! Agents are ready to battle.');
}

seed();
