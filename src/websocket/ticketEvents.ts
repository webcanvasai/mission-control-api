import { Server, Socket } from 'socket.io';
import { WatcherService } from '../services/watcherService';
import { TicketService } from '../services/ticketService';
import { GroomingService } from '../services/groomingService';
import { extractTicketId } from '../utils/ticketParser';
import { ServerToClientEvents, ClientToServerEvents } from '../types/ticket';
import config from '../config';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * Set up WebSocket event handlers
 */
export function setupWebSocket(
  io: TypedServer,
  watcher: WatcherService,
  ticketService: TicketService,
  groomingService?: GroomingService
): void {
  // Track connected clients
  let clientCount = 0;

  // Handle client connections
  io.on('connection', async (socket: TypedSocket) => {
    clientCount++;
    console.log(`[WebSocket] Client connected: ${socket.id} (${clientCount} total)`);

    // Send current ticket list on connect
    try {
      const tickets = await ticketService.listTickets();
      socket.emit('tickets:init', tickets);
    } catch (error) {
      console.error('[WebSocket] Error sending initial tickets:', error);
      socket.emit('error', { message: 'Failed to load tickets' });
    }

    // Handle subscription to specific ticket (for future use)
    socket.on('ticket:subscribe', (ticketId: string) => {
      socket.join(`ticket:${ticketId}`);
      console.log(`[WebSocket] ${socket.id} subscribed to ${ticketId}`);
    });

    socket.on('ticket:unsubscribe', (ticketId: string) => {
      socket.leave(`ticket:${ticketId}`);
      console.log(`[WebSocket] ${socket.id} unsubscribed from ${ticketId}`);
    });

    socket.on('disconnect', () => {
      clientCount--;
      console.log(`[WebSocket] Client disconnected: ${socket.id} (${clientCount} remaining)`);
    });
  });

  // Forward file watcher events to WebSocket clients
  watcher.on('ticket:created', async (filePath: string) => {
    try {
      const id = extractTicketId(filePath);
      // Small delay to ensure file is fully written
      await new Promise(resolve => setTimeout(resolve, 100));
      const ticket = await ticketService.getTicket(id);
      io.emit('ticket:created', ticket);
      console.log(`[WebSocket] Broadcasted ticket:created for ${id}`);

      // Trigger auto-grooming if enabled and service available
      if (groomingService && config.autoGroomingEnabled) {
        // Run in background (don't await)
        groomingService.handleNewTicket(filePath).catch(err => {
          console.error(`[Grooming] Background grooming error for ${id}:`, err);
        });
      }
    } catch (error) {
      console.error('[WebSocket] Error broadcasting ticket:created:', error);
    }
  });

  watcher.on('ticket:updated', async (filePath: string) => {
    try {
      const id = extractTicketId(filePath);
      const ticket = await ticketService.getTicket(id);
      io.emit('ticket:updated', ticket);
      // Also emit to ticket-specific room
      io.to(`ticket:${id}`).emit('ticket:updated', ticket);
      console.log(`[WebSocket] Broadcasted ticket:updated for ${id}`);
    } catch (error) {
      console.error('[WebSocket] Error broadcasting ticket:updated:', error);
    }
  });

  watcher.on('ticket:deleted', (filePath: string) => {
    try {
      const id = extractTicketId(filePath);
      io.emit('ticket:deleted', { id });
      console.log(`[WebSocket] Broadcasted ticket:deleted for ${id}`);
    } catch (error) {
      console.error('[WebSocket] Error broadcasting ticket:deleted:', error);
    }
  });

  console.log('[WebSocket] Event handlers configured');
}
