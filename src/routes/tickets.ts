import { Router } from 'express';
import { TicketService } from '../services/ticketService';
import { asyncHandler } from '../middleware/errorHandler';
import { validateBody, validateQuery, validateTicketId } from '../middleware/validation';
import { 
  CreateTicketSchema, 
  UpdateTicketSchema, 
  ListTicketsQuerySchema 
} from '../types/ticket';

/**
 * Create ticket routes with injected service
 */
export function createTicketRoutes(ticketService: TicketService): Router {
  const router = Router();

  /**
   * GET /api/tickets
   * List all tickets with optional filtering and sorting
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
   */
  router.post(
    '/',
    validateBody(CreateTicketSchema),
    asyncHandler(async (req, res) => {
      const ticket = await ticketService.createTicket(req.body);
      res.status(201).json({ ticket });
    })
  );

  /**
   * PATCH /api/tickets/:id
   * Update an existing ticket (partial update)
   */
  router.patch(
    '/:id',
    validateTicketId,
    validateBody(UpdateTicketSchema),
    asyncHandler(async (req, res) => {
      const ticket = await ticketService.updateTicket(req.params.id as string, req.body);
      res.json({ ticket });
    })
  );

  /**
   * DELETE /api/tickets/:id
   * Delete a ticket
   */
  router.delete(
    '/:id',
    validateTicketId,
    asyncHandler(async (req, res) => {
      await ticketService.deleteTicket(req.params.id as string);
      res.status(204).send();
    })
  );

  return router;
}
