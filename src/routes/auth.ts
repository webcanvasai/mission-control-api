import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, requireRole, UserRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabase';

/**
 * Create auth routes for user management
 */
export function createAuthRoutes(): Router {
  const router = Router();

  /**
   * GET /api/auth/me
   * Get current user info and role
   * Requires: any authenticated user
   */
  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      // Get full user details from auth to include metadata
      const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(req.user!.id);
      
      res.json({
        user: {
          id: req.user!.id,
          email: req.user!.email,
          role: req.user!.role,
          displayName: user?.user_metadata?.display_name || req.user!.email,
        }
      });
    })
  );

  /**
   * GET /api/auth/users
   * List all users (admin only)
   * Requires: admin role
   */
  router.get(
    '/users',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      // Get all users from auth.users via admin API
      const { data: authUsers, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
      
      if (usersError) {
        return res.status(500).json({ error: 'Failed to fetch users', message: usersError.message });
      }

      // Get all roles
      const { data: roles, error: rolesError } = await supabaseAdmin
        .from('user_roles')
        .select('user_id, role, created_at');

      if (rolesError) {
        return res.status(500).json({ error: 'Failed to fetch roles', message: rolesError.message });
      }

      // Map roles to users
      const roleMap = new Map(roles?.map(r => [r.user_id, r]) || []);
      
      const users = authUsers.users.map(user => ({
        id: user.id,
        email: user.email,
        role: roleMap.get(user.id)?.role || 'viewer',
        createdAt: user.created_at,
        lastSignIn: user.last_sign_in_at,
        emailConfirmed: user.email_confirmed_at != null,
      }));

      res.json({ users });
    })
  );

  /**
   * PATCH /api/auth/users/:userId/role
   * Update a user's role (admin only)
   * Requires: admin role
   */
  router.patch(
    '/users/:userId/role',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { userId } = req.params;
      const { role } = req.body;

      // Validate role
      const validRoles: UserRole[] = ['admin', 'editor', 'viewer'];
      if (!role || !validRoles.includes(role as UserRole)) {
        return res.status(400).json({ 
          error: 'Invalid role',
          message: `Role must be one of: ${validRoles.join(', ')}`
        });
      }

      // Prevent admin from demoting themselves (safety measure)
      if (userId === req.user!.id && role !== 'admin') {
        return res.status(400).json({
          error: 'Cannot demote yourself',
          message: 'Admins cannot change their own role. Ask another admin to do it.'
        });
      }

      // Upsert role
      const { data, error } = await supabaseAdmin
        .from('user_roles')
        .upsert(
          { user_id: userId, role, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        )
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to update role', message: error.message });
      }

      console.log(`[Auth] Role updated: ${userId} -> ${role} by ${req.user!.email}`);
      res.json({ success: true, role: data.role });
    })
  );

  /**
   * DELETE /api/auth/users/:userId
   * Delete a user (admin only)
   * Requires: admin role
   */
  router.delete(
    '/users/:userId',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const userId = req.params.userId as string;

      // Prevent admin from deleting themselves
      if (userId === req.user!.id) {
        return res.status(400).json({
          error: 'Cannot delete yourself',
          message: 'Admins cannot delete their own account.'
        });
      }

      // Delete user from Supabase Auth (will cascade to user_roles)
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

      if (error) {
        return res.status(500).json({ error: 'Failed to delete user', message: error.message });
      }

      console.log(`[Auth] User deleted: ${userId} by ${req.user!.email}`);
      res.json({ success: true });
    })
  );

  /**
   * POST /api/auth/invite
   * Invite a new user by email (admin only)
   * Creates user with magic link
   * Requires: admin role
   */
  router.post(
    '/invite',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { email, role = 'viewer' } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      // Validate role
      const validRoles: UserRole[] = ['admin', 'editor', 'viewer'];
      if (!validRoles.includes(role as UserRole)) {
        return res.status(400).json({ 
          error: 'Invalid role',
          message: `Role must be one of: ${validRoles.join(', ')}`
        });
      }

      // Invite user via Supabase
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);

      if (error) {
        return res.status(500).json({ error: 'Failed to invite user', message: error.message });
      }

      // Set role (if not first user, otherwise trigger handles it)
      if (data.user) {
        await supabaseAdmin
          .from('user_roles')
          .upsert(
            { user_id: data.user.id, role },
            { onConflict: 'user_id' }
          );
      }

      console.log(`[Auth] User invited: ${email} as ${role} by ${req.user!.email}`);
      res.json({ success: true, email, role });
    })
  );

  return router;
}
