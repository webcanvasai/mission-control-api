import { Server, Socket } from 'socket.io';
import { WatcherService } from '../services/watcherService';
import { TicketService } from '../services/ticketService';
import { GroomingService } from '../services/groomingService';
import { extractTicketId } from '../utils/ticketParser';
import { ServerToClientEvents, ClientToServerEvents } from '../types/ticket';
import { supabaseAdmin } from '../lib/supabase';
import config from '../config';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface AuthenticatedSocket extends TypedSocket {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

/**
 * Set up WebSocket event handlers with authentication
 */
export function setupWebSocket(
  io: TypedServer,
  watcher: WatcherService,
  ticketService: TicketService,
  groomingService?: GroomingService
): void {
  // Track connected clients
  let clientCount = 0;

  // Authentication middleware for WebSocket connections
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      
      if (!token) {
        console.log('[WebSocket] Connection rejected: No token provided');
        return next(new Error('Authentication required'));
      }

      // Verify token with Supabase
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

      if (error || !user) {
        console.log('[WebSocket] Connection rejected: Invalid token');
        return next(new Error('Invalid authentication token'));
      }

      // Fetch user role
      const { data: roleData } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      // Attach user info to socket
      socket.user = {
        id: user.id,
        email: user.email || 'unknown',
        role: roleData?.role || 'viewer'
      };

      console.log(`[WebSocket] Authenticated: ${socket.user.email} (${socket.user.role})`);
      next();
    } catch (error) {
      console.error('[WebSocket] Auth error:', error);
      next(new Error('Authentication failed'));
    }
  });

  // Handle client connections
  io.on('connection', async (socket: AuthenticatedSocket) => {
    clientCount++;
    const userInfo = socket.user ? `${socket.user.email} (${socket.user.role})` : 'unknown';
    console.log(`[WebSocket] Client connected: ${socket.id} - ${userInfo} (${clientCount} total)`);

    // Send current ticket list on connect
    try {
      console.log(`[WebSocket] Fetching tickets for ${socket.id}...`);
      const tickets = await ticketService.listTickets();
      console.log(`[WebSocket] Sending ${tickets.length} tickets to ${socket.id}`);
      socket.emit('tickets:init', tickets);
      console.log(`[WebSocket] tickets:init emitted to ${socket.id}`);
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
