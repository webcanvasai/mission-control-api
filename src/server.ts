import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import config from './config';
import { TicketService } from './services/ticketService';
import { WatcherService } from './services/watcherService';
import { GroomingService } from './services/groomingService';
import { createTicketRoutes } from './routes/tickets';
import { createAuthRoutes } from './routes/auth';
import { setupWebSocket } from './websocket/ticketEvents';
import { errorHandler } from './middleware/errorHandler';
import { requireAuth, requireRole } from './middleware/auth';
import { ServerToClientEvents, ClientToServerEvents } from './types/ticket';

// Create Express app
const app = express();
const httpServer = createServer(app);

// Create Socket.io server with CORS
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[API] ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Create services
const ticketService = new TicketService(config.vaultPath);
const watcherService = new WatcherService();
const groomingService = new GroomingService(ticketService);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const health = await ticketService.healthCheck();
    const activeSessions = groomingService.getActiveGroomingSessions();
    
    res.json({
      ...health,
      watcher: watcherService.isWatching() ? 'running' : 'stopped',
      grooming: {
        enabled: config.autoGroomingEnabled,
        gatewayUrl: config.openclawGatewayUrl,
        hasToken: !!config.openclawToken,
        activeSessions: activeSessions.size,
        sessions: Array.from(activeSessions.entries()).map(([id, session]) => ({
          ticketId: id,
          sessionKey: session.sessionKey,
          startedAt: session.startedAt.toISOString()
        }))
      },
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Manual grooming trigger endpoint (requires editor or admin)
app.post('/api/tickets/:id/groom', requireAuth, requireRole('editor', 'admin'), async (req, res) => {
  const id = req.params.id as string;
  
  try {
    const result = await groomingService.manualGroom(id);
    
    if (result.success) {
      res.json({
        status: 'triggered',
        ticketId: id,
        sessionKey: result.sessionKey
      });
    } else {
      res.status(400).json({
        status: 'failed',
        ticketId: id,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      status: 'error',
      ticketId: id,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Auth routes (user management)
app.use('/api/auth', createAuthRoutes());

// API routes (protected)
app.use('/api/tickets', createTicketRoutes(ticketService));

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Set up WebSocket handlers
setupWebSocket(io, watcherService, ticketService, groomingService);

// Graceful shutdown
function shutdown() {
  console.log('\n[Server] Shutting down...');
  
  watcherService.stop();
  
  io.close(() => {
    console.log('[Server] WebSocket server closed');
  });
  
  httpServer.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
watcherService.start(config.vaultPath);

httpServer.listen(config.port, () => {
  console.log('='.repeat(50));
  console.log('Mission Control API Server');
  console.log('='.repeat(50));
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Port: ${config.port}`);
  console.log(`Vault: ${config.vaultPath}`);
  console.log(`CORS: ${Array.isArray(config.corsOrigin) ? config.corsOrigin.join(', ') : config.corsOrigin}`);
  console.log('='.repeat(50));
  console.log('Auto-Grooming:');
  console.log(`  Enabled: ${config.autoGroomingEnabled}`);
  console.log(`  Gateway: ${config.openclawGatewayUrl}`);
  console.log(`  Token: ${config.openclawToken ? '***configured***' : 'NOT SET'}`);
  console.log('='.repeat(50));
  console.log(`API: http://localhost:${config.port}/api/tickets`);
  console.log(`Health: http://localhost:${config.port}/api/health`);
  console.log(`Manual Groom: POST /api/tickets/:id/groom`);
  console.log(`WebSocket: ws://localhost:${config.port}`);
  console.log('='.repeat(50));
});

export { app, httpServer, io };
