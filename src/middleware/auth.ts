import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Middleware to require authentication
 * Validates JWT token and attaches user info to request
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : null;

    if (!token) {
      res.status(401).json({ 
        error: 'Authentication required',
        message: 'No authorization token provided'
      });
      return;
    }

    // Verify token with Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      console.log('[Auth] Token validation failed:', error?.message);
      res.status(401).json({ 
        error: 'Invalid token',
        message: error?.message || 'Token validation failed'
      });
      return;
    }

    // Fetch user role from user_roles table
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError && roleError.code !== 'PGRST116') {
      // PGRST116 = no rows found (new user, will get default role)
      console.error('[Auth] Error fetching role:', roleError);
    }

    // Default to viewer if no role found
    const role: UserRole = (roleData?.role as UserRole) || 'viewer';

    // Attach user info to request
    req.user = {
      id: user.id,
      email: user.email || 'unknown',
      role
    };

    console.log(`[Auth] Authenticated: ${req.user.email} (${role})`);
    next();
  } catch (error) {
    console.error('[Auth] Unexpected error:', error);
    res.status(500).json({ 
      error: 'Authentication error',
      message: 'An unexpected error occurred during authentication'
    });
  }
}

/**
 * Middleware factory to require specific roles
 * Usage: requireRole('admin', 'editor')
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ 
        error: 'Authentication required',
        message: 'You must be authenticated to access this resource'
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      console.log(`[Auth] Access denied: ${req.user.email} (${req.user.role}) requires ${allowedRoles.join(' or ')}`);
      res.status(403).json({ 
        error: 'Insufficient permissions',
        message: `This action requires ${allowedRoles.join(' or ')} role. You have ${req.user.role} role.`
      });
      return;
    }

    next();
  };
}

/**
 * Optional auth - attaches user if token present, continues otherwise
 * Useful for endpoints that work differently for authenticated users
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') 
    ? authHeader.slice(7) 
    : null;

  if (!token) {
    next();
    return;
  }

  try {
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    
    if (user) {
      const { data: roleData } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      req.user = {
        id: user.id,
        email: user.email || 'unknown',
        role: (roleData?.role as UserRole) || 'viewer'
      };
    }
  } catch {
    // Ignore auth errors for optional auth
  }

  next();
}
