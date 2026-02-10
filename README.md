# Mission Control API Server

A Node.js API server for Mission Control that watches Obsidian vault ticket files and broadcasts changes via WebSocket. Includes **auto-grooming** capability via OpenClaw integration.

## Features

- **REST API** - CRUD operations for ticket management
- **File Watcher** - Monitors Obsidian vault for ticket file changes (chokidar)
- **WebSocket** - Real-time updates to connected clients (Socket.io)
- **Auto-Grooming** - Automatically grooms minimal tickets using AI agent
- **TypeScript** - Full type safety with Zod validation

## Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server
npm start

# Development mode (auto-reload)
npm run dev

# Run tests
npm test
```

## Configuration

Create a `.env` file:

```env
PORT=3001
VAULT_PATH=/home/chris/Kolenko/Mission Control/tickets
CORS_ORIGIN=https://mc.ctx.gg
NODE_ENV=production

# Auto-Grooming Configuration
AUTO_GROOMING_ENABLED=true
OPENCLAW_GATEWAY_URL=http://localhost:8080
OPENCLAW_TOKEN=your-token-here
```

## Auto-Grooming

### How It Works

When a new ticket is created with minimal content, the server automatically detects it and triggers a grooming agent to expand the ticket with:

1. **Technical implementation details** (phased approach)
2. **Acceptance criteria** (testable requirements)
3. **Dependencies** on other tickets/systems
4. **Story point estimates** (1, 2, 3, 5, 8, 13)
5. **Success metrics**
6. **Edge cases and considerations**

### Auto-Groom Triggers

A ticket qualifies for auto-grooming if ALL conditions are met:

- **Status**: `backlog` or missing estimate
- **Content**: < 500 characters OR missing "Implementation Details"
- **Age**: Created within the last 5 minutes
- **Not already grooming**: No active grooming session

### Grooming Status

Tickets track grooming status in frontmatter:

```yaml
grooming:
  status: pending | in-progress | complete | failed | manual
  triggeredAt: '2026-02-06T10:00:00Z'
  completedAt: '2026-02-06T10:02:00Z'
  sessionKey: 'groom-TICK-001-1234567890'
  attempts: 1
  lastError: 'Optional error message if failed'
```

### Grooming Quality Score

The system calculates a grooming quality score (0-100) based on:

| Section | Points |
|---------|--------|
| Has estimate | +20 |
| Has Tasks section | +15 |
| Has Acceptance Criteria | +20 |
| Has Dependencies | +15 |
| Has Success Metrics | +10 |
| Has Implementation Details | +10 |
| Content > 2000 chars | +10 |
| **Total** | **100** |

A ticket with score ≥60 is considered well-groomed.

### Manual Grooming

Trigger grooming manually via API or CLI:

```bash
# Via API
curl -X POST http://localhost:3001/api/tickets/TICK-001/groom

# Via OpenClaw CLI
openclaw agent --agent grooming --session-id groom:TICK-001 --message "Groom TICK-001"

# Via WhatsApp (if configured)
"Groom ticket TICK-001"
```

### Disabling Auto-Grooming

Set `AUTO_GROOMING_ENABLED=false` in `.env` or omit the OpenClaw configuration.

### Troubleshooting

**Grooming not triggering:**
- Check `GET /api/health` to verify grooming is enabled
- Ensure `OPENCLAW_TOKEN` is set correctly
- Verify ticket meets auto-groom conditions (check server logs)

**Grooming fails repeatedly:**
- Check OpenClaw gateway is running: `openclaw gateway status`
- Check grooming agent exists: `ls ~/.openclaw/workspace/agents/grooming-agent/`
- Review server logs: `journalctl -u mission-control-api -f`

**Grooming times out:**
- Tickets requiring complex grooming may take >5 minutes
- Check if grooming completed by looking at ticket content
- Timeout session is cleaned up automatically after 10 minutes

## API Endpoints

### Health Check
```
GET /api/health
```

Returns server health including grooming status:
```json
{
  "status": "healthy",
  "vaultPath": "/home/chris/Kolenko/Mission Control/tickets",
  "ticketCount": 42,
  "watcher": "running",
  "grooming": {
    "enabled": true,
    "gatewayUrl": "http://localhost:8080",
    "hasToken": true,
    "activeSessions": 0
  }
}
```

### Tickets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/tickets | List all tickets |
| GET | /api/tickets/:id | Get single ticket |
| POST | /api/tickets | Create new ticket |
| PATCH | /api/tickets/:id | Update ticket |
| DELETE | /api/tickets/:id | Delete ticket |
| POST | /api/tickets/:id/groom | Trigger manual grooming |

### Query Parameters (GET /api/tickets)

- `status` - Filter by status (backlog, groomed, in-progress, done)
- `priority` - Filter by priority (low, medium, high)
- `project` - Filter by project name
- `assignee` - Filter by assignee
- `sort` - Sort field (id, createdAt, updatedAt, priority)
- `order` - Sort order (asc, desc)

### Examples

```bash
# List all tickets
curl http://localhost:3001/api/tickets

# Filter by status
curl "http://localhost:3001/api/tickets?status=in-progress"

# Get single ticket (includes grooming status and quality score)
curl http://localhost:3001/api/tickets/TICK-001

# Create minimal ticket (triggers auto-grooming)
curl -X POST http://localhost:3001/api/tickets \
  -H "Content-Type: application/json" \
  -d '{"title":"Add dark mode","project":"Mission Control","body":"Users want dark mode support."}'

# Create detailed ticket (no auto-grooming)
curl -X POST http://localhost:3001/api/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Implement caching",
    "project":"Mission Control",
    "estimate": 5,
    "body":"**Problem:**\nAPI slow.\n\n**Implementation Details:**\nUse Redis..."
  }'

# Update ticket
curl -X PATCH http://localhost:3001/api/tickets/TICK-001 \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'

# Delete ticket
curl -X DELETE http://localhost:3001/api/tickets/TICK-001

# Trigger manual grooming
curl -X POST http://localhost:3001/api/tickets/TICK-001/groom
```

## WebSocket Events

### Server → Client

| Event | Description |
|-------|-------------|
| `tickets:init` | Initial ticket list on connection |
| `ticket:created` | New ticket created (file added) |
| `ticket:updated` | Ticket modified (file changed) or grooming completed |
| `ticket:deleted` | Ticket removed (file deleted) |

### Client → Server

| Event | Description |
|-------|-------------|
| `ticket:subscribe` | Subscribe to specific ticket updates |
| `ticket:unsubscribe` | Unsubscribe from ticket updates |

### Example WebSocket Client

```javascript
import { io } from 'socket.io-client';

const socket = io('ws://localhost:3001');

socket.on('tickets:init', (tickets) => {
  console.log('Initial tickets:', tickets);
});

socket.on('ticket:created', (ticket) => {
  console.log('New ticket:', ticket.id);
  if (ticket.grooming?.status === 'pending') {
    console.log('Auto-grooming will start...');
  }
});

socket.on('ticket:updated', (ticket) => {
  console.log('Ticket updated:', ticket.id);
  if (ticket.grooming?.status === 'complete') {
    console.log('Grooming complete! New content:', ticket.body.length, 'chars');
  }
});
```

## Minimal Ticket Template

Create tickets with minimal content to trigger auto-grooming:

```markdown
---
id: TICK-XXX
title: Brief, descriptive title
status: backlog
priority: medium
project: ProjectName
createdAt: '2026-01-01T00:00:00Z'
updatedAt: '2026-01-01T00:00:00Z'
grooming:
  status: pending
---
**Problem:**
Brief description of what needs to be done.

**Context:**
Any relevant background or links.
```

Template file: `/home/chris/Kolenko/Mission Control/templates/TICKET-TEMPLATE.md`

## Testing

```bash
# Run all tests
npm test

# Run tests once (CI mode)
npm run test:run

# Watch mode (auto-rerun on changes)
npm test -- --watch
```

### Test Coverage

Tests cover:
- Ticket CRUD operations
- Grooming trigger conditions
- Grooming quality score calculation
- Grooming status updates
- File watcher events
- WebSocket broadcasts

## Deployment (systemd)

```bash
# Copy service file
sudo cp mission-control-api.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable mission-control-api
sudo systemctl start mission-control-api

# Check status
sudo systemctl status mission-control-api

# View logs
journalctl -u mission-control-api -f
```

## Project Structure

```
src/
├── server.ts               # Main entry point
├── config.ts               # Configuration
├── types/
│   └── ticket.ts           # TypeScript types & Zod schemas
├── services/
│   ├── ticketService.ts    # Ticket CRUD operations
│   ├── watcherService.ts   # File watcher service
│   └── groomingService.ts  # Auto-grooming logic & OpenClaw integration
├── routes/
│   └── tickets.ts          # Express routes
├── middleware/
│   ├── errorHandler.ts     # Error handling
│   └── validation.ts       # Request validation
├── utils/
│   └── ticketParser.ts     # Markdown/YAML parsing
├── websocket/
│   └── ticketEvents.ts     # Socket.io handlers
└── __tests__/              # Test files
    ├── groomingService.test.ts
    └── ticketService.test.ts
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Mission Control API                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   REST API   │    │  WebSocket   │    │  File Watcher    │  │
│  │   (Express)  │    │  (Socket.io) │    │   (Chokidar)     │  │
│  └──────┬───────┘    └──────┬───────┘    └────────┬─────────┘  │
│         │                   │                      │            │
│         │                   │                      │            │
│         v                   v                      v            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Ticket Service                          │ │
│  │   - CRUD operations on ticket files                        │ │
│  │   - Parse/serialize YAML frontmatter + Markdown            │ │
│  └───────────────────────────┬────────────────────────────────┘ │
│                              │                                  │
│                              v                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                   Grooming Service                         │ │
│  │   - Auto-groom detection (shouldAutoGroom)                 │ │
│  │   - Quality score calculation                              │ │
│  │   - OpenClaw CLI integration                               │ │
│  │   - Session tracking & timeout handling                    │ │
│  └───────────────────────────┬────────────────────────────────┘ │
│                              │                                  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               v
                    ┌──────────────────────┐
                    │   OpenClaw Gateway   │
                    │   (Grooming Agent)   │
                    └──────────────────────┘
                               │
                               v
                    ┌──────────────────────┐
                    │    Claude API        │
                    └──────────────────────┘
```

## License

MIT
