const { Client } = require('pg');

// Supabase database connection string (Transaction mode via Supavisor)
const DATABASE_URL = 'postgresql://postgres.mzoajbvcfwdkokvgkpdf:SupabaseServiceKey123@aws-0-us-west-1.pooler.supabase.com:6543/postgres';

// Alternative: Direct connection (if pooler doesn't work)
const DIRECT_URL = 'postgresql://postgres.mzoajbvcfwdkokvgkpdf:SupabaseServiceKey123@db.mzoajbvcfwdkokvgkpdf.supabase.co:5432/postgres';

async function runMigration() {
  // Try multiple connection strings
  const urls = [
    { name: 'Pooler (Transaction)', url: DATABASE_URL },
    { name: 'Direct', url: DIRECT_URL },
  ];

  let client = null;
  let connected = false;

  for (const { name, url } of urls) {
    console.log(`Trying ${name} connection...`);
    client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    
    try {
      await client.connect();
      console.log(`✅ Connected via ${name}`);
      connected = true;
      break;
    } catch (err) {
      console.log(`❌ ${name} failed:`, err.message);
      client = null;
    }
  }

  if (!connected || !client) {
    console.error('\n❌ Could not connect to database.');
    console.log('\n📋 Please run the migration manually in Supabase SQL Editor:');
    console.log('   1. Go to https://supabase.com/dashboard/project/mzoajbvcfwdkokvgkpdf/sql');
    console.log('   2. Copy contents of: supabase/migrations/003_project_access_control.sql');
    console.log('   3. Run the SQL');
    return;
  }

  try {
    console.log('\n📋 Running migration...\n');

    // Create table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.project_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        project_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, project_name)
      )
    `);
    console.log('✅ Created project_members table');

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON public.project_members(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_project_members_project_name ON public.project_members(project_name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_project_members_user_project ON public.project_members(user_id, project_name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_project_members_role ON public.project_members(role)`);
    console.log('✅ Created indexes');

    // Enable RLS
    await client.query(`ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY`);
    console.log('✅ Enabled RLS');

    // Drop existing policies
    await client.query(`DROP POLICY IF EXISTS "Authenticated users can read project memberships" ON public.project_members`);
    await client.query(`DROP POLICY IF EXISTS "Service role can manage memberships" ON public.project_members`);

    // Create policies
    await client.query(`
      CREATE POLICY "Authenticated users can read project memberships"
        ON public.project_members FOR SELECT
        TO authenticated
        USING (true)
    `);
    await client.query(`
      CREATE POLICY "Service role can manage memberships"
        ON public.project_members FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true)
    `);
    console.log('✅ Created RLS policies');

    // Grant permissions
    await client.query(`GRANT SELECT ON public.project_members TO authenticated`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO service_role`);
    console.log('✅ Granted permissions');

    // Seed data - get admin user
    const adminResult = await client.query(`
      SELECT ur.user_id, au.email
      FROM public.user_roles ur
      JOIN auth.users au ON ur.user_id = au.id
      WHERE ur.role = 'admin'
      ORDER BY au.created_at
      LIMIT 1
    `);

    if (adminResult.rows.length > 0) {
      const adminId = adminResult.rows[0].user_id;
      const adminEmail = adminResult.rows[0].email;
      console.log(`\n📋 Found admin: ${adminEmail} (${adminId})`);

      const projects = ['Mission Control', 'Uncategorized'];
      for (const project of projects) {
        await client.query(`
          INSERT INTO public.project_members (user_id, project_name, role)
          VALUES ($1, $2, 'owner')
          ON CONFLICT (user_id, project_name) DO NOTHING
        `, [adminId, project]);
        console.log(`✅ Added admin as owner of "${project}"`);
      }
    } else {
      console.log('\n⚠️  No admin user found, skipping seed data');
    }

    console.log('\n🎉 Migration complete!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await client.end();
  }
}

runMigration();
