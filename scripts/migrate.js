#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mzoajbvcfwdkokvgkpdf.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16b2FqYnZjZndka29rdmdrcGRmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY4NzE5MCwiZXhwIjoyMDg2MjYzMTkwfQ.M7Aa_XgLSlFN-6uxzIqfJZBjZ85r714b6wHAAeiEKO8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function checkTableExists() {
  const { data, error } = await supabase
    .from('project_members')
    .select('*')
    .limit(1);
  
  return !error || error.code !== 'PGRST205';
}

async function seedProjectMemberships() {
  console.log('Seeding project memberships...');
  
  // Get admin user
  const { data: roleData, error: roleError } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
    .limit(1);

  if (roleError || !roleData || roleData.length === 0) {
    console.log('No admin found, skipping seed');
    return false;
  }

  const adminId = roleData[0].user_id;
  console.log('Admin user ID:', adminId);

  // Get user email
  const { data: userData } = await supabase.auth.admin.getUserById(adminId);
  console.log('Admin email:', userData?.user?.email);

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

  return true;
}

async function main() {
  console.log('🔍 Checking if project_members table exists...\n');
  
  const exists = await checkTableExists();
  
  if (exists) {
    console.log('✅ Table project_members exists');
    
    // Verify and seed
    const { data, error } = await supabase
      .from('project_members')
      .select('*');
    
    console.log('Current members:', data?.length || 0);
    
    if (data?.length === 0) {
      await seedProjectMemberships();
    } else {
      console.log('Data:');
      console.table(data);
    }
    
    return;
  }

  console.log('❌ Table does not exist');
  console.log('\n📋 Please run the following migration in Supabase SQL Editor:');
  console.log('   1. Go to: https://supabase.com/dashboard/project/mzoajbvcfwdkokvgkpdf/sql');
  console.log('   2. Create a new query');
  console.log('   3. Copy & paste the contents of: supabase/migrations/003_project_access_control.sql');
  console.log('   4. Run the query');
  console.log('\nAlternatively, use the Supabase CLI with direct database connection.');
}

main().catch(console.error);
