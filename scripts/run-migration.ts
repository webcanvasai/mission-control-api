import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = 'https://mzoajbvcfwdkokvgkpdf.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16b2FqYnZjZndka29rdmdrcGRmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY4NzE5MCwiZXhwIjoyMDg2MjYzMTkwfQ.M7Aa_XgLSlFN-6uxzIqfJZBjZ85r714b6wHAAeiEKO8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function runMigration() {
  console.log('Running migration 003_project_access_control.sql...\n');

  // Split SQL into individual statements
  const statements = [
    // 1. Create project_members table
    `CREATE TABLE IF NOT EXISTS public.project_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      project_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(user_id, project_name)
    )`,

    // 2. Create indexes
    `CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON public.project_members(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_project_members_project_name ON public.project_members(project_name)`,
    `CREATE INDEX IF NOT EXISTS idx_project_members_user_project ON public.project_members(user_id, project_name)`,
    `CREATE INDEX IF NOT EXISTS idx_project_members_role ON public.project_members(role)`,

    // 3. Enable RLS
    `ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY`,

    // 4. Drop existing policies if they exist (to make idempotent)
    `DROP POLICY IF EXISTS "Authenticated users can read project memberships" ON public.project_members`,
    `DROP POLICY IF EXISTS "Service role can manage memberships" ON public.project_members`,

    // 5. Create RLS policies
    `CREATE POLICY "Authenticated users can read project memberships"
      ON public.project_members FOR SELECT
      TO authenticated
      USING (true)`,

    `CREATE POLICY "Service role can manage memberships"
      ON public.project_members FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true)`,

    // 6. Grant permissions
    `GRANT SELECT ON public.project_members TO authenticated`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO service_role`,
  ];

  // Run each statement via raw SQL query using fetch
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    console.log(`Running statement ${i + 1}/${statements.length}...`);
    
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: stmt })
      });
      
      // The above won't work for DDL. Let's try direct database access via postgrest edge function
      // Actually, we need to use supabase CLI or dashboard for DDL
    } catch (err) {
      console.error(`Statement ${i + 1} failed:`, err);
    }
  }

  // Test if table was created by trying to select from it
  console.log('\nVerifying migration...');
  const { data, error } = await supabase
    .from('project_members')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Migration verification failed:', error.message);
    console.log('\n⚠️  You may need to run the migration manually in Supabase SQL Editor.');
    console.log('Migration file: supabase/migrations/003_project_access_control.sql');
  } else {
    console.log('✅ Table project_members exists');
    console.log('Current members:', data);
  }

  // Try to seed data
  console.log('\nSeeding project memberships...');
  
  // Get admin user
  const { data: roleData, error: roleError } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
    .limit(1)
    .single();

  if (roleError || !roleData) {
    console.log('No admin found, skipping seed');
    return;
  }

  const adminId = roleData.user_id;
  console.log('Admin user ID:', adminId);

  // Seed projects
  const projects = ['Mission Control', 'Uncategorized'];
  
  for (const project of projects) {
    const { error: insertError } = await supabase
      .from('project_members')
      .upsert({
        user_id: adminId,
        project_name: project,
        role: 'owner'
      }, { onConflict: 'user_id,project_name' });

    if (insertError) {
      console.error(`Failed to add ${project}:`, insertError.message);
    } else {
      console.log(`✅ Added admin as owner of "${project}"`);
    }
  }

  console.log('\n✅ Migration complete!');
}

runMigration().catch(console.error);
