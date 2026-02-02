import { dbOps } from '../lib/db';

async function deleteDuplicateAgent() {
  console.log('Finding duplicate agents...\n');

  // Get all agents
  const agents = await dbOps.getAllAgents();

  // Get pixel counts
  const pixelCounts = await dbOps.getAgentPixelCounts();
  const countMap = new Map(pixelCounts.map(p => [p.agent_id, p.count]));

  // Find agents named "JacksonPollocksGhost"
  const duplicates = agents.filter(a => a.name === 'JacksonPollocksGhost');

  console.log(`Found ${duplicates.length} agents named "JacksonPollocksGhost":\n`);

  for (const agent of duplicates) {
    const pixels = countMap.get(agent.id) || 0;
    console.log(`  ID: ${agent.id}`);
    console.log(`  Pixels: ${pixels}`);
    console.log(`  Color: ${agent.color}`);
    console.log('');
  }

  // Delete the one with 0 pixels
  const toDelete = duplicates.find(a => (countMap.get(a.id) || 0) === 0);

  if (toDelete) {
    console.log(`Deleting agent with 0 pixels: ${toDelete.id}`);
    const deleted = await dbOps.deleteAgent(toDelete.id);
    if (deleted) {
      console.log('✓ Deleted successfully');
    } else {
      console.log('✗ Failed to delete');
    }
  } else {
    console.log('No agent with 0 pixels found to delete');
  }
}

deleteDuplicateAgent().catch(console.error);
