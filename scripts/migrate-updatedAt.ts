#!/usr/bin/env npx ts-node
/**
 * Migration script: Backfill updatedAt for all tickets
 * 
 * For tickets missing updatedAt, sets it to createdAt.
 * For tickets missing both, sets both to current timestamp.
 * 
 * Usage: npx ts-node scripts/migrate-updatedAt.ts [vault-path]
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';

const DEFAULT_VAULT_PATH = '/home/chris/Kolenko/Mission Control/tickets';

async function migrate(vaultPath: string): Promise<void> {
  console.log(`📁 Scanning tickets in: ${vaultPath}\n`);
  
  const files = await fs.readdir(vaultPath);
  const ticketFiles = files.filter(f => /^TICK-\d+\.md$/.test(f));
  
  console.log(`Found ${ticketFiles.length} tickets\n`);
  
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const file of ticketFiles) {
    const filePath = path.join(vaultPath, file);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data, content: body } = matter(content);
      
      const now = new Date().toISOString();
      let needsUpdate = false;
      
      // Ensure createdAt exists
      if (!data.createdAt) {
        data.createdAt = now;
        needsUpdate = true;
        console.log(`  ${file}: Added missing createdAt`);
      }
      
      // Ensure updatedAt exists (fall back to createdAt)
      if (!data.updatedAt) {
        data.updatedAt = data.createdAt;
        needsUpdate = true;
        console.log(`  ${file}: Added updatedAt = createdAt`);
      }
      
      if (needsUpdate) {
        const updatedContent = matter.stringify(body, data);
        await fs.writeFile(filePath, updatedContent, 'utf-8');
        updated++;
      } else {
        skipped++;
      }
    } catch (error) {
      console.error(`  ❌ ${file}: ${(error as Error).message}`);
      errors++;
    }
  }
  
  console.log('\n--- Summary ---');
  console.log(`✅ Updated: ${updated}`);
  console.log(`⏭️  Skipped (already had updatedAt): ${skipped}`);
  if (errors > 0) {
    console.log(`❌ Errors: ${errors}`);
  }
  console.log('\nMigration complete!');
}

// Run migration
const vaultPath = process.argv[2] || DEFAULT_VAULT_PATH;
migrate(vaultPath).catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
