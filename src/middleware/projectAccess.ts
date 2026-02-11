import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';

export type ProjectRole = 'owner' | 'member' | 'viewer';

interface ProjectMembership {
  project_name: string;
  role: ProjectRole;
}

// Role hierarchy for comparison
const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  owner: 3,
  member: 2,
  viewer: 1,
};

/**
 * Check if user is an admin (has global access)
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('[ProjectAccess] Error checking admin status:', error.message);
    return false;
  }

  return data?.role === 'admin';
}

/**
 * Get user's role in a specific project
 */
export async function getProjectRole(
  userId: string,
  projectName: string
): Promise<ProjectRole | null> {
  const { data, error } = await supabaseAdmin
    .from('project_members')
    .select('role')
    .eq('user_id', userId)
    .eq('project_name', projectName)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      // PGRST116 = no rows found
      console.error('[ProjectAccess] Error fetching project role:', error.message);
    }
    return null;
  }

  return data?.role as ProjectRole;
}

/**
 * Get all projects a user has access to
 */
export async function getUserProjects(userId: string): Promise<ProjectMembership[]> {
  // Check if admin first
  const admin = await isAdmin(userId);
  
  if (admin) {
    // Admins have access to all projects - return empty array as marker
    // The caller should handle this by not filtering
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from('project_members')
    .select('project_name, role')
    .eq('user_id', userId);

  if (error) {
    console.error('[ProjectAccess] Error fetching user projects:', error.message);
    return [];
  }

  return (data || []) as ProjectMembership[];
}

/**
 * Verify user has access to a project with minimum required role
 */
export async function verifyProjectAccess(
  userId: string,
  projectName: string,
  requiredRole: ProjectRole = 'viewer'
): Promise<boolean> {
  // Check admin bypass
  const admin = await isAdmin(userId);
  if (admin) {
    return true;
  }

  // Get project role
  const role = await getProjectRole(userId, projectName);
  if (!role) {
    return false;
  }

  // Check role hierarchy
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Check if user has at least one of the required project roles
 */
export function hasMinimumRole(
  userRole: ProjectRole,
  requiredRole: ProjectRole
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Middleware: Require project access for a specific project
 * Expects projectName in req.params or req.body
 */
export function requireProjectAccess(requiredRole: ProjectRole = 'viewer') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'You must be authenticated to access this resource',
      });
      return;
    }

    const projectName =
      req.params.projectName ||
      req.params.name ||
      req.body?.project ||
      req.query?.project;

    if (!projectName) {
      res.status(400).json({
        error: 'Project required',
        message: 'Project name is required for this operation',
      });
      return;
    }

    const hasAccess = await verifyProjectAccess(
      req.user.id,
      projectName as string,
      requiredRole
    );

    if (!hasAccess) {
      console.log(
        `[ProjectAccess] Access denied: ${req.user.email} to ${projectName} (requires ${requiredRole})`
      );
      res.status(403).json({
        error: 'Access denied',
        message: `You don't have ${requiredRole} access to project "${projectName}"`,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware: Filter tickets by accessible projects
 * Attaches accessibleProjects to req for use in route handlers
 */
export async function attachAccessibleProjects(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({
      error: 'Authentication required',
      message: 'You must be authenticated to access this resource',
    });
    return;
  }

  try {
    const admin = await isAdmin(req.user.id);
    
    // Store on request for route handlers
    (req as any).isProjectAdmin = admin;

    if (admin) {
      // Admins see all projects
      (req as any).accessibleProjects = null; // null = no filter
    } else {
      const projects = await getUserProjects(req.user.id);
      (req as any).accessibleProjects = projects.map((p) => p.project_name);
    }

    next();
  } catch (error) {
    console.error('[ProjectAccess] Error attaching accessible projects:', error);
    res.status(500).json({
      error: 'Access check failed',
      message: 'An error occurred while checking project access',
    });
  }
}

/**
 * Get project member count
 */
export async function getProjectMemberCount(projectName: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('project_members')
    .select('*', { count: 'exact', head: true })
    .eq('project_name', projectName);

  if (error) {
    console.error('[ProjectAccess] Error counting members:', error.message);
    return 0;
  }

  return count || 0;
}

/**
 * Add a member to a project
 */
export async function addProjectMember(
  userId: string,
  projectName: string,
  role: ProjectRole
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabaseAdmin.from('project_members').insert({
    user_id: userId,
    project_name: projectName,
    role,
  });

  if (error) {
    if (error.code === '23505') {
      // Unique constraint violation
      return { success: false, error: 'User is already a member of this project' };
    }
    console.error('[ProjectAccess] Error adding member:', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Update a member's role
 */
export async function updateProjectMemberRole(
  userId: string,
  projectName: string,
  newRole: ProjectRole
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from('project_members')
    .update({ role: newRole })
    .eq('user_id', userId)
    .eq('project_name', projectName);

  if (error) {
    console.error('[ProjectAccess] Error updating member role:', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Remove a member from a project
 */
export async function removeProjectMember(
  userId: string,
  projectName: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from('project_members')
    .delete()
    .eq('user_id', userId)
    .eq('project_name', projectName);

  if (error) {
    console.error('[ProjectAccess] Error removing member:', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Count owners in a project (to prevent removing last owner)
 */
export async function countProjectOwners(projectName: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('project_members')
    .select('*', { count: 'exact', head: true })
    .eq('project_name', projectName)
    .eq('role', 'owner');

  if (error) {
    console.error('[ProjectAccess] Error counting owners:', error.message);
    return 0;
  }

  return count || 0;
}

/**
 * Get all members of a project
 */
export async function getProjectMembers(projectName: string): Promise<
  Array<{
    user_id: string;
    email: string;
    role: ProjectRole;
    created_at: string;
  }>
> {
  const { data, error } = await supabaseAdmin
    .from('project_members')
    .select('user_id, role, created_at')
    .eq('project_name', projectName);

  if (error) {
    console.error('[ProjectAccess] Error fetching members:', error.message);
    return [];
  }

  // Fetch user emails from auth.users
  const userIds = (data || []).map((m) => m.user_id);
  
  if (userIds.length === 0) {
    return [];
  }

  // Get user details
  const members: Array<{
    user_id: string;
    email: string;
    role: ProjectRole;
    created_at: string;
  }> = [];

  for (const member of data || []) {
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(
      member.user_id
    );
    
    members.push({
      user_id: member.user_id,
      email: userData?.user?.email || 'unknown',
      role: member.role as ProjectRole,
      created_at: member.created_at,
    });
  }

  return members;
}

/**
 * Get distinct project names from project_members table
 */
export async function getAllProjects(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('project_members')
    .select('project_name')
    .order('project_name');

  if (error) {
    console.error('[ProjectAccess] Error fetching all projects:', error.message);
    return [];
  }

  // Get unique project names
  const unique = [...new Set((data || []).map((p) => p.project_name))];
  return unique;
}
