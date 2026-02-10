-- Fix RLS policies for user_roles table
-- The existing policy might be too restrictive

-- Drop existing policies
DROP POLICY IF EXISTS "Users can read own role" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;

-- Simpler policy: All authenticated users can read all roles
-- (Roles are not sensitive - just admin/editor/viewer)
CREATE POLICY "Authenticated users can read roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can insert/update/delete roles
CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
