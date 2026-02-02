import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:clawplace.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function resetDatabase() {
  console.log('Connecting to database...');
  console.log('URL:', process.env.TURSO_DATABASE_URL ? 'Turso (production)' : 'Local file');

  console.log('\nDeleting all pixels...');
  const pixelResult = await db.execute('DELETE FROM pixels');
  console.log(`✓ Deleted ${pixelResult.rowsAffected} pixels`);

  console.log('\nDeleting pixel history...');
  const historyResult = await db.execute('DELETE FROM pixel_history');
  console.log(`✓ Deleted ${historyResult.rowsAffected} history entries`);

  console.log('\nDeleting all agents...');
  const agentResult = await db.execute('DELETE FROM agents');
  console.log(`✓ Deleted ${agentResult.rowsAffected} agents`);

  console.log('\n✓ Database reset complete!');
}

resetDatabase().catch(console.error);
