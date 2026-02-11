import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  getUserProjects,
  getProjectMembers,
  getProjectMemberCount,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  verifyProjectAccess,
  countProjectOwners,
  isAdmin,
  getAllProjects,
  ProjectRole,
} from '../middleware/projectAccess';
import { supabaseAdmin } from '../lib/supabase';
import { TicketService } from '../services/ticketService';
import config from '../config';

/**
 * Create project routes for managing project memberships
 */
export function createProjectRoutes(ticketService: TicketService): Router {
  const router = Router();

  // All project routes require authentication
  router.use(requireAuth);

  /**
   * GET /api/projects
   * List all projects the user has access to
   * Includes member count and user's role
   */
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const userIsAdmin = await isAdmin(req.user!.id);

      // Get projects from tickets (source of truth)
      const tickets = await ticketService.listTickets();
      const ticketProjects = [...new Set(tickets.map((t) => t.project || 'Uncategorized'))];

      // Get user's project memberships
      const memberships = await getUserProjects(req.user!.id);
      const membershipMap = new Map(memberships.map((m) => [m.project_name, m.role]));

      // Build project list
      const projects: Array<{
        name: string;
        role: ProjectRole | 'admin';
        memberCount: number;
        ticketCount: number;
      }> = [];

      for (const projectName of ticketProjects) {
        // Check access
        const userRole = membershipMap.get(projectName);
        const hasAccess = userIsAdmin || !!userRole;

        if (!hasAccess) {
          continue;
        }

        const memberCount = await getProjectMemberCount(projectName);
        const ticketCount = tickets.filter(
          (t) => (t.project || 'Uncategorized') === projectName
        ).length;

        projects.push({
          name: projectName,
          role: userIsAdmin ? 'admin' : userRole!,
          memberCount,
          ticketCount,
        });
      }

      // Also include projects user has access to but no tickets exist
      for (const membership of memberships) {
        if (!projects.find((p) => p.name === membership.project_name)) {
          const memberCount = await getProjectMemberCount(membership.project_name);
          projects.push({
            name: membership.project_name,
            role: membership.role,
            memberCount,
            ticketCount: 0,
          });
        }
      }

      // Sort by name
      projects.sort((a, b) => a.name.localeCompare(b.name));

      res.json({ projects });
    })
  );

  /**
   * GET /api/projects/:name/members
   * List members of a project
   * Requires: viewer access to the project
   */
  router.get(
    '/:name/members',
    asyncHandler(async (req, res) => {
      const projectName = decodeURIComponent(req.params.name as string);

      // Check access
      const hasAccess = await verifyProjectAccess(
        req.user!.id,
        projectName,
        'viewer'
      );

      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: `You don't have access to project "${projectName}"`,
        });
      }

      const members = await getProjectMembers(projectName);
      res.json({ members });
    })
  );

  /**
   * POST /api/projects/:name/members
   * Add a member to a project
   * Requires: owner role in project or admin
   */
  router.post(
    '/:name/members',
    asyncHandler(async (req, res) => {
      const projectName = decodeURIComponent(req.params.name as string);
      const { email, role = 'viewer' } = req.body;

      if (!email) {
        return res.status(400).json({
          error: 'Email required',
          message: 'Please provide the email of the user to add',
        });
      }

      // Validate role
      const validRoles: ProjectRole[] = ['owner', 'member', 'viewer'];
      if (!validRoles.includes(role as ProjectRole)) {
        return res.status(400).json({
          error: 'Invalid role',
          message: `Role must be one of: ${validRoles.join(', ')}`,
        });
      }

      // Check if user has owner access (or is admin)
      const userIsAdmin = await isAdmin(req.user!.id);
      const hasAccess = await verifyProjectAccess(
        req.user!.id,
        projectName,
        'owner'
      );

      if (!hasAccess && !userIsAdmin) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Only project owners and admins can add members',
        });
      }

      // Find user by email
      const { data: authData, error: authError } =
        await supabaseAdmin.auth.admin.listUsers();

      if (authError) {
        return res.status(500).json({
          error: 'Failed to look up user',
          message: authError.message,
        });
      }

      const targetUser = authData.users.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      );

      if (!targetUser) {
        return res.status(404).json({
          error: 'User not found',
          message: `No user found with email "${email}"`,
        });
      }

      // Add member
      const result = await addProjectMember(targetUser.id, projectName, role);

      if (!result.success) {
        return res.status(409).json({
          error: 'Failed to add member',
          message: result.error,
        });
      }

      console.log(
        `[Projects] ${req.user!.email} added ${email} as ${role} to ${projectName}`
      );

      res.status(201).json({
        success: true,
        member: {
          user_id: targetUser.id,
          email: targetUser.email,
          role,
        },
      });
    })
  );

  /**
   * PATCH /api/projects/:name/members/:userId
   * Update a member's role
   * Requires: owner role in project or admin
   */
  router.patch(
    '/:name/members/:userId',
    asyncHandler(async (req, res) => {
      const projectName = decodeURIComponent(req.params.name as string);
      const targetUserId = req.params.userId as string;
      const { role } = req.body;

      if (!role) {
        return res.status(400).json({
          error: 'Role required',
          message: 'Please provide the new role',
        });
      }

      // Validate role
      const validRoles: ProjectRole[] = ['owner', 'member', 'viewer'];
      if (!validRoles.includes(role as ProjectRole)) {
        return res.status(400).json({
          error: 'Invalid role',
          message: `Role must be one of: ${validRoles.join(', ')}`,
        });
      }

      // Check if user has owner access (or is admin)
      const userIsAdmin = await isAdmin(req.user!.id);
      const hasAccess = await verifyProjectAccess(
        req.user!.id,
        projectName,
        'owner'
      );

      if (!hasAccess && !userIsAdmin) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Only project owners and admins can update roles',
        });
      }

      // Check if demoting the last owner
      if (role !== 'owner') {
        const ownerCount = await countProjectOwners(projectName);
        
        // Check if target user is currently an owner
        const members = await getProjectMembers(projectName);
        const targetMember = members.find((m) => m.user_id === targetUserId);
        
        if (targetMember?.role === 'owner' && ownerCount <= 1) {
          return res.status(400).json({
            error: 'Cannot demote last owner',
            message:
              'This is the last owner. Promote another member to owner first.',
          });
        }
      }

      // Update role
      const result = await updateProjectMemberRole(
        targetUserId,
        projectName,
        role
      );

      if (!result.success) {
        return res.status(500).json({
          error: 'Failed to update role',
          message: result.error,
        });
      }

      console.log(
        `[Projects] ${req.user!.email} updated ${targetUserId} role to ${role} in ${projectName}`
      );

      res.json({ success: true, role });
    })
  );

  /**
   * DELETE /api/projects/:name/members/:userId
   * Remove a member from a project
   * Requires: owner role in project or admin
   */
  router.delete(
    '/:name/members/:userId',
    asyncHandler(async (req, res) => {
      const projectName = decodeURIComponent(req.params.name as string);
      const targetUserId = req.params.userId as string;

      // Check if user has owner access (or is admin)
      const userIsAdmin = await isAdmin(req.user!.id);
      const hasAccess = await verifyProjectAccess(
        req.user!.id,
        projectName,
        'owner'
      );

      if (!hasAccess && !userIsAdmin) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Only project owners and admins can remove members',
        });
      }

      // Prevent removing the last owner
      const ownerCount = await countProjectOwners(projectName);
      const members = await getProjectMembers(projectName);
      const targetMember = members.find((m) => m.user_id === targetUserId);

      if (targetMember?.role === 'owner' && ownerCount <= 1) {
        return res.status(400).json({
          error: 'Cannot remove last owner',
          message:
            'This is the last owner. Transfer ownership before removing.',
        });
      }

      // Remove member
      const result = await removeProjectMember(targetUserId, projectName);

      if (!result.success) {
        return res.status(500).json({
          error: 'Failed to remove member',
          message: result.error,
        });
      }

      console.log(
        `[Projects] ${req.user!.email} removed ${targetUserId} from ${projectName}`
      );

      res.json({ success: true });
    })
  );

  /**
   * GET /api/projects/all
   * List all projects (admin only)
   * Used for orphaned ticket management
   */
  router.get(
    '/all',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      // Get projects from tickets
      const tickets = await ticketService.listTickets();
      const ticketProjects = [...new Set(tickets.map((t) => t.project || 'Uncategorized'))];

      // Get projects from memberships
      const membershipProjects = await getAllProjects();

      // Combine and dedupe
      const allProjects = [...new Set([...ticketProjects, ...membershipProjects])];

      const projects: Array<{
        name: string;
        memberCount: number;
        ticketCount: number;
        hasMembers: boolean;
      }> = [];

      for (const projectName of allProjects) {
        const memberCount = await getProjectMemberCount(projectName);
        const ticketCount = tickets.filter(
          (t) => (t.project || 'Uncategorized') === projectName
        ).length;

        projects.push({
          name: projectName,
          memberCount,
          ticketCount,
          hasMembers: memberCount > 0,
        });
      }

      // Sort by name
      projects.sort((a, b) => a.name.localeCompare(b.name));

      res.json({ projects });
    })
  );

  return router;
}
