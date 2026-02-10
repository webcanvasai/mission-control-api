import { Router } from 'express';
import { TicketService } from '../services/ticketService';
import { asyncHandler } from '../middleware/errorHandler';
import { validateBody, validateQuery, validateTicketId } from '../middleware/validation';
import { requireAuth, requireRole } from '../middleware/auth';
import { 
  CreateTicketSchema, 
  UpdateTicketSchema, 
  ListTicketsQuerySchema 
} from '../types/ticket';

/**
 * Create ticket routes with injected service
 * All routes require authentication
 * Write operations require editor or admin role
 * Delete operations require admin role
 */
export function createTicketRoutes(ticketService: TicketService): Router {
  const router = Router();

  // Apply authentication to all ticket routes
  router.use(requireAuth);

  /**
   * GET /api/tickets
   * List all tickets with optional filtering and sorting
   * Requires: any authenticated user
   */
  router.get(
    '/',
    validateQuery(ListTicketsQuerySchema),
    asyncHandler(async (req, res) => {
      const query = res.locals.query as ReturnType<typeof ListTicketsQuerySchema.parse>;
      const tickets = await ticketService.listTickets(query);
      res.json({ tickets, count: tickets.length });
    })
  );

  /**
   * GET /api/tickets/:id
   * Get a single ticket by ID
   * Requires: any authenticated user
   */
  router.get(
    '/:id',
    validateTicketId,
    asyncHandler(async (req, res) => {
      const ticket = await ticketService.getTicket(req.params.id as string);
      res.json({ ticket });
    })
  );

  /**
   * POST /api/tickets
   * Create a new ticket
   * Requires: editor or admin role
   */
  router.post(
    '/',
    requireRole('editor', 'admin'),
    validateBody(CreateTicketSchema),
    asyncHandler(async (req, res) => {
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
   * Requires: editor or admin role
   */
  router.patch(
    '/:id',
    requireRole('editor', 'admin'),
    validateTicketId,
    validateBody(UpdateTicketSchema),
    asyncHandler(async (req, res) => {
      // Add updatedBy metadata
      const updateData = {
        ...req.body,
        updatedBy: req.user?.email,
      };
      const ticket = await ticketService.updateTicket(req.params.id as string, updateData);
      res.json({ ticket });
    })
  );

  /**
   * DELETE /api/tickets/:id
   * Delete a ticket
   * Requires: admin role only
   */
  router.delete(
    '/:id',
    requireRole('admin'),
    validateTicketId,
    asyncHandler(async (req, res) => {
      await ticketService.deleteTicket(req.params.id as string);
      res.status(204).send();
    })
  );

  /**
   * PATCH /api/tickets/:id/move
   * Move a ticket to a different status lane (updates status and timestamp)
   * Requires: editor or admin role
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
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
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
