import { z } from 'zod';

// Grooming status types
export type GroomingStatusValue = 'pending' | 'in-progress' | 'complete' | 'failed' | 'manual';

// Extended grooming status schema
export const GroomingSchema = z.object({
  status: z.enum(['pending', 'in-progress', 'complete', 'failed', 'manual']),
  triggeredAt: z.string().optional(),
  completedAt: z.string().optional(),
  sessionKey: z.string().optional(),
  attempts: z.number().optional(),
  lastError: z.string().optional()
}).optional();

// TypeScript type for grooming status
export interface GroomingStatus {
  status: GroomingStatusValue;
  triggeredAt?: string;
  completedAt?: string;
  sessionKey?: string;
  attempts?: number;
  lastError?: string;
}

export const TicketStatusSchema = z.enum(['backlog', 'todo', 'in-progress', 'done']);

export const TicketMetadataSchema = z.object({
  id: z.string().regex(/^TICK-\d+$/, 'Invalid ticket ID format'),
  title: z.string().min(1, 'Title is required'),
  status: TicketStatusSchema,
  priority: z.enum(['low', 'medium', 'high']),
  project: z.string(),
  assignee: z.string().optional(),
  estimate: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  grooming: GroomingSchema
});

export const CreateTicketSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  status: TicketStatusSchema.default('backlog'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  project: z.string().default('Uncategorized'),
  assignee: z.string().optional(),
  estimate: z.number().optional(),
  body: z.string().optional()
});

export const UpdateTicketSchema = z.object({
  title: z.string().min(1).optional(),
  status: TicketStatusSchema.optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  project: z.string().optional(),
  assignee: z.string().optional(),
  estimate: z.number().optional(),
  body: z.string().optional(),
  grooming: GroomingSchema
});

// TypeScript types
export type TicketMetadata = z.infer<typeof TicketMetadataSchema>;
export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;
export type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>;

export interface Ticket extends TicketMetadata {
  body: string;
  filePath: string;
}

// Query parameters for listing tickets
export const ListTicketsQuerySchema = z.object({
  status: TicketStatusSchema.optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  project: z.string().optional(),
  assignee: z.string().optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'priority', 'id']).default('id'),
  order: z.enum(['asc', 'desc']).default('asc')
});

export type ListTicketsQuery = z.infer<typeof ListTicketsQuerySchema>;

// WebSocket event types
export interface ServerToClientEvents {
  'tickets:init': (tickets: Ticket[]) => void;
  'ticket:created': (ticket: Ticket) => void;
  'ticket:updated': (ticket: Ticket) => void;
  'ticket:deleted': (data: { id: string }) => void;
  'error': (data: { message: string }) => void;
}

export interface ClientToServerEvents {
  'ticket:subscribe': (ticketId: string) => void;
  'ticket:unsubscribe': (ticketId: string) => void;
}
