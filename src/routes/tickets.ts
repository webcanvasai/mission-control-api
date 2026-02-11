import { Router } from 'express';
import { TicketService } from '../services/ticketService';
import { asyncHandler } from '../middleware/errorHandler';
import { validateBody, validateQuery, validateTicketId } from '../middleware/validation';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  attachAccessibleProjects,
  verifyProjectAccess,
  isAdmin,
} from '../middleware/projectAccess';
import {
  CreateTicketSchema,
  UpdateTicketSchema,
  ListTicketsQuerySchema,
} from '../types/ticket';

/**
 * Create ticket routes with injected service
 * All routes require authentication
 * Access is filtered by project membership
 */
export function createTicketRoutes(ticketService: TicketService): Router {
  const router = Router();

  // Apply authentication to all ticket routes
  router.use(requireAuth);

  /**
   * GET /api/tickets
   * List all tickets with optional filtering and sorting
   * Filters by user's accessible projects
   * Requires: any authenticated user with project access
   */
  router.get(
    '/',
    attachAccessibleProjects,
    validateQuery(ListTicketsQuerySchema),
    asyncHandler(async (req, res) => {
      const query = res.locals.query as ReturnType<typeof ListTicketsQuerySchema.parse>;
      const accessibleProjects = (req as any).accessibleProjects as string[] | null;
      const isProjectAdmin = (req as any).isProjectAdmin as boolean;

      // Get all tickets
      let tickets = await ticketService.listTickets(query);

      // Filter by accessible projects (unless admin)
      if (!isProjectAdmin && accessibleProjects !== null) {
        if (accessibleProjects.length === 0) {
          // User has no project access
          tickets = [];
        } else {
          tickets = tickets.filter((t) =>
            accessibleProjects.includes(t.project || 'Uncategorized')
          );
        }
      }

      res.json({ tickets, count: tickets.length });
    })
  );

  /**
   * GET /api/tickets/:id
   * Get a single ticket by ID
   * Requires: viewer access to ticket's project
   */
  router.get(
    '/:id',
    validateTicketId,
    asyncHandler(async (req, res) => {
      const ticket = await ticketService.getTicket(req.params.id as string);

      // Check project access
      const hasAccess = await verifyProjectAccess(
        req.user!.id,
        ticket.project || 'Uncategorized',
        'viewer'
      );

      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: `You don't have access to project "${ticket.project}"`,
        });
      }

      res.json({ ticket });
    })
  );

  /**
   * POST /api/tickets
   * Create a new ticket
   * Requires: member role in the target project (or editor/admin global role)
   */
  router.post(
    '/',
    requireRole('editor', 'admin'),
    validateBody(CreateTicketSchema),
    asyncHandler(async (req, res) => {
      const projectName = req.body.project || 'Uncategorized';

      // Check project access (member role required for creating tickets)
      const hasAccess = await verifyProjectAccess(req.user!.id, projectName, 'member');

      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: `You don't have permission to create tickets in project "${projectName}"`,
        });
      }

      // Add createdBy metadata
      const ticketData = {
        ...req.body,
        createdBy: req.user?.email,
      };
      const ticket = await ticketService.createTicket(ticketData);
      res.status(201).json({ ticket });
    })
  );

  /**
   * PATCH /api/tickets/:id
   * Update an existing ticket (partial update)
   * Requires: member role in ticket's project (or editor/admin global role)
   */
  router.patch(
    '/:id',
    requireRole('editor', 'admin'),
    validateTicketId,
    validateBody(UpdateTicketSchema),
    asyncHandler(async (req, res) => {
      // Get existing ticket to check its project
      const existing = await ticketService.getTicket(req.params.id as string);
      const projectName = existing.project || 'Uncategorized';

      // Check project access
      const hasAccess = await verifyProjectAccess(req.user!.id, projectName, 'member');

      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: `You don't have permission to edit tickets in project "${projectName}"`,
        });
      }

      // If changing project, verify access to new project too
      if (req.body.project && req.body.project !== projectName) {
        const hasNewProjectAccess = await verifyProjectAccess(
          req.user!.id,
          req.body.project,
          'member'
        );

        if (!hasNewProjectAccess) {
          return res.status(403).json({
            error: 'Access denied',
            message: `You don't have permission to move tickets to project "${req.body.project}"`,
          });
        }
      }

      // Add updatedBy metadata
      const updateData = {
        ...req.body,
        updatedBy: req.user?.email,
      };
      const ticket = await ticketService.updateTicket(
        req.params.id as string,
        updateData
      );
      res.json({ ticket });
    })
  );

  /**
   * DELETE /api/tickets/:id
   * Delete a ticket
   * Requires: owner role in ticket's project (or admin global role)
   */
  router.delete(
    '/:id',
    requireRole('admin'),
    validateTicketId,
    asyncHandler(async (req, res) => {
      // Get existing ticket to check its project
      const existing = await ticketService.getTicket(req.params.id as string);
      const projectName = existing.project || 'Uncategorized';

      // Check if user is admin (can delete any ticket)
      const userIsAdmin = await isAdmin(req.user!.id);

      if (!userIsAdmin) {
        // Non-admins need owner role in the project
        const hasAccess = await verifyProjectAccess(
          req.user!.id,
          projectName,
          'owner'
        );

        if (!hasAccess) {
          return res.status(403).json({
            error: 'Access denied',
            message: `You need owner access to delete tickets in project "${projectName}"`,
          });
        }
      }

      await ticketService.deleteTicket(req.params.id as string);
      res.status(204).send();
    })
  );

  /**
   * PATCH /api/tickets/:id/move
   * Move a ticket to a different status lane (updates status and timestamp)
   * Requires: member role in ticket's project (or editor/admin global role)
   */
  router.patch(
    '/:id/move',
    requireRole('editor', 'admin'),
    validateTicketId,
    asyncHandler(async (req, res) => {
      const { newStatus } = req.body;

      if (!newStatus) {
        return res.status(400).json({ error: 'newStatus is required' });
      }

      const validStatuses = ['backlog', 'groomed', 'todo', 'in-progress', 'done'];
      if (!validStatuses.includes(newStatus)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        });
      }

      // Get existing ticket to check its project
      const existing = await ticketService.getTicket(req.params.id as string);
      const projectName = existing.project || 'Uncategorized';

      // Check project access
      const hasAccess = await verifyProjectAccess(req.user!.id, projectName, 'member');

      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: `You don't have permission to move tickets in project "${projectName}"`,
        });
      }

      const ticket = await ticketService.updateTicket(req.params.id as string, {
        status: newStatus,
        updatedBy: req.user?.email,
      });

      res.json({ success: true, ticket });
    })
  );

  return router;
}
