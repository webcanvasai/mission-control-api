-- Migration: Project-based Access Control
-- TICK-048: Add project membership table and RLS policies
-- Run this in Supabase SQL Editor or via migration tool

-- ==============================================================================
-- 1. Create project_members table
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, project_name)
);

-- Add comment for documentation
COMMENT ON TABLE public.project_members IS 'Project membership and role assignments for access control';
COMMENT ON COLUMN public.project_members.role IS 'owner: full control, member: read/write, viewer: read only';

-- ==============================================================================
-- 2. Create indexes for performance
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_project_members_user_id 
  ON public.project_members(user_id);

CREATE INDEX IF NOT EXISTS idx_project_members_project_name 
  ON public.project_members(project_name);

CREATE INDEX IF NOT EXISTS idx_project_members_user_project 
  ON public.project_members(user_id, project_name);

CREATE INDEX IF NOT EXISTS idx_project_members_role 
  ON public.project_members(role);

-- ==============================================================================
-- 3. Enable RLS with permissive policies (avoid previous RLS hang issues)
-- ==============================================================================

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- Policy: All authenticated users can read project memberships
-- (Using true for SELECT to avoid RLS performance issues - API handles access control)
CREATE POLICY "Authenticated users can read project memberships"
  ON public.project_members FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Only service_role can modify memberships
-- (API uses service role for all modifications)
CREATE POLICY "Service role can manage memberships"
  ON public.project_members FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ==============================================================================
-- 4. Grant permissions
-- ==============================================================================

GRANT SELECT ON public.project_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO service_role;

-- ==============================================================================
-- 5. Helper functions
-- ==============================================================================

-- Function to check if a user has access to a project with minimum role
CREATE OR REPLACE FUNCTION public.check_project_access(
  p_user_id UUID,
  p_project_name TEXT,
  p_required_role TEXT DEFAULT 'viewer'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT;
  v_is_admin BOOLEAN;
  v_role_level INTEGER;
  v_required_level INTEGER;
BEGIN
  -- Check if user is admin (bypass project access)
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = 'admin'
  ) INTO v_is_admin;
  
  IF v_is_admin THEN
    RETURN TRUE;
  END IF;
  
  -- Get user's project role
  SELECT role INTO v_role
  FROM public.project_members
  WHERE user_id = p_user_id AND project_name = p_project_name;
  
  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Role hierarchy: owner=3, member=2, viewer=1
  v_role_level := CASE v_role
    WHEN 'owner' THEN 3
    WHEN 'member' THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0
  END;
  
  v_required_level := CASE p_required_role
    WHEN 'owner' THEN 3
    WHEN 'member' THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0
  END;
  
  RETURN v_role_level >= v_required_level;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Function to get user's accessible projects
CREATE OR REPLACE FUNCTION public.get_user_projects(p_user_id UUID)
RETURNS TABLE (
  project_name TEXT,
  role TEXT,
  is_admin BOOLEAN
) AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Check if user is admin
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = 'admin'
  ) INTO v_is_admin;
  
  -- If admin, return special marker (API will handle showing all projects)
  IF v_is_admin THEN
    RETURN QUERY SELECT NULL::TEXT, 'admin'::TEXT, TRUE;
    RETURN;
  END IF;
  
  -- Return user's project memberships
  RETURN QUERY
  SELECT pm.project_name, pm.role, FALSE
  FROM public.project_members pm
  WHERE pm.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ==============================================================================
-- 6. Updated_at trigger
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_project_members_updated_at ON public.project_members;
CREATE TRIGGER update_project_members_updated_at
  BEFORE UPDATE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==============================================================================
-- 7. Seed data: Assign existing user as owner of all existing projects
-- ==============================================================================

-- First, find the existing admin user (mc@shhemail.com or first admin)
DO $$
DECLARE
  v_admin_id UUID;
  v_project TEXT;
  v_existing_projects TEXT[];
BEGIN
  -- Get the admin user ID
  SELECT ur.user_id INTO v_admin_id
  FROM public.user_roles ur
  JOIN auth.users au ON ur.user_id = au.id
  WHERE ur.role = 'admin'
  ORDER BY au.created_at
  LIMIT 1;
  
  IF v_admin_id IS NULL THEN
    RAISE NOTICE 'No admin user found, skipping seed data';
    RETURN;
  END IF;
  
  -- Hard-coded projects from Mission Control (can be expanded)
  -- These are the known projects from the ticket files
  v_existing_projects := ARRAY['Mission Control', 'Uncategorized'];
  
  -- Assign admin as owner of each project
  FOREACH v_project IN ARRAY v_existing_projects
  LOOP
    INSERT INTO public.project_members (user_id, project_name, role)
    VALUES (v_admin_id, v_project, 'owner')
    ON CONFLICT (user_id, project_name) DO NOTHING;
    
    RAISE NOTICE 'Assigned user % as owner of project %', v_admin_id, v_project;
  END LOOP;
END $$;

-- ==============================================================================
-- Complete!
-- ==============================================================================
