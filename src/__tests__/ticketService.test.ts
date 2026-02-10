import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { TicketService, NotFoundError } from '../services/ticketService';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('TicketService', () => {
  let ticketService: TicketService;
  let testDir: string;

  beforeAll(async () => {
    // Create a temp directory for test tickets
    testDir = path.join(os.tmpdir(), `mission-control-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    ticketService = new TicketService(testDir);
    // Clean test directory before each test
    const files = await fs.readdir(testDir);
    for (const file of files) {
      await fs.unlink(path.join(testDir, file));
    }
  });

  describe('healthCheck', () => {
    it('should return healthy status with ticket count', async () => {
      const result = await ticketService.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.vaultPath).toBe(testDir);
      expect(result.ticketCount).toBe(0);
    });
  });

  describe('createTicket', () => {
    it('should create a new ticket with auto-generated ID', async () => {
      const input = {
        title: 'Test Ticket',
        priority: 'high' as const,
        project: 'Test Project',
      };

      const ticket = await ticketService.createTicket(input);

      expect(ticket.id).toBe('TICK-001');
      expect(ticket.title).toBe('Test Ticket');
      expect(ticket.status).toBe('backlog');
      expect(ticket.priority).toBe('high');
      expect(ticket.project).toBe('Test Project');
      expect(ticket.createdAt).toBeDefined();
      expect(ticket.updatedAt).toBeDefined();
    });

    it('should increment ticket ID for subsequent tickets', async () => {
      await ticketService.createTicket({ title: 'First' });
      const second = await ticketService.createTicket({ title: 'Second' });

      expect(second.id).toBe('TICK-002');
    });

    it('should create ticket file on disk', async () => {
      await ticketService.createTicket({ title: 'Test' });

      const files = await fs.readdir(testDir);
      expect(files).toContain('TICK-001.md');
    });

    it('should set default values for optional fields', async () => {
      const ticket = await ticketService.createTicket({ title: 'Minimal' });

      expect(ticket.status).toBe('backlog');
      expect(ticket.priority).toBe('medium');
      expect(ticket.project).toBe('Uncategorized');
      expect(ticket.body).toBe('');
    });
  });

  describe('getTicket', () => {
    it('should return existing ticket', async () => {
      const created = await ticketService.createTicket({
        title: 'Test Ticket',
        body: 'Test body content',
      });

      const ticket = await ticketService.getTicket(created.id);

      expect(ticket.id).toBe(created.id);
      expect(ticket.title).toBe('Test Ticket');
      expect(ticket.body).toBe('Test body content');
    });

    it('should throw NotFoundError for non-existent ticket', async () => {
      await expect(ticketService.getTicket('TICK-999')).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateTicket', () => {
    it('should update ticket fields', async () => {
      const created = await ticketService.createTicket({
        title: 'Original Title',
        status: 'backlog',
      });

      const updated = await ticketService.updateTicket(created.id, {
        title: 'Updated Title',
        status: 'in-progress',
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.status).toBe('in-progress');
      expect(updated.id).toBe(created.id); // ID should not change
    });

    it('should update grooming status', async () => {
      const created = await ticketService.createTicket({ title: 'Test' });

      const updated = await ticketService.updateTicket(created.id, {
        grooming: {
          status: 'in-progress',
          triggeredAt: new Date().toISOString(),
        },
      });

      expect(updated.grooming?.status).toBe('in-progress');
    });

    it('should update the updatedAt timestamp', async () => {
      const created = await ticketService.createTicket({ title: 'Test' });
      const originalUpdatedAt = created.updatedAt;

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await ticketService.updateTicket(created.id, {
        status: 'done',
      });

      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(originalUpdatedAt).getTime()
      );
    });

    it('should throw NotFoundError for non-existent ticket', async () => {
      await expect(
        ticketService.updateTicket('TICK-999', { title: 'New Title' })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteTicket', () => {
    it('should delete existing ticket', async () => {
      const created = await ticketService.createTicket({ title: 'To Delete' });

      await ticketService.deleteTicket(created.id);

      const files = await fs.readdir(testDir);
      expect(files).not.toContain(`${created.id}.md`);
    });

    it('should throw NotFoundError for non-existent ticket', async () => {
      await expect(ticketService.deleteTicket('TICK-999')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listTickets', () => {
    beforeEach(async () => {
      // Create some test tickets
      await ticketService.createTicket({
        title: 'High Priority',
        priority: 'high',
        status: 'in-progress',
        project: 'Project A',
      });
      await ticketService.createTicket({
        title: 'Low Priority',
        priority: 'low',
        status: 'backlog',
        project: 'Project B',
      });
      await ticketService.createTicket({
        title: 'Medium Priority',
        priority: 'medium',
        status: 'done',
        project: 'Project A',
      });
    });

    it('should list all tickets', async () => {
      const tickets = await ticketService.listTickets();

      expect(tickets.length).toBe(3);
    });

    it('should filter by status', async () => {
      const tickets = await ticketService.listTickets({ status: 'backlog' });

      expect(tickets.length).toBe(1);
      expect(tickets[0].title).toBe('Low Priority');
    });

    it('should filter by priority', async () => {
      const tickets = await ticketService.listTickets({ priority: 'high' });

      expect(tickets.length).toBe(1);
      expect(tickets[0].title).toBe('High Priority');
    });

    it('should filter by project', async () => {
      const tickets = await ticketService.listTickets({ project: 'Project A' });

      expect(tickets.length).toBe(2);
    });

    it('should sort by id ascending by default', async () => {
      const tickets = await ticketService.listTickets();

      expect(tickets[0].id).toBe('TICK-001');
      expect(tickets[2].id).toBe('TICK-003');
    });

    it('should sort by id descending', async () => {
      const tickets = await ticketService.listTickets({ order: 'desc' });

      expect(tickets[0].id).toBe('TICK-003');
      expect(tickets[2].id).toBe('TICK-001');
    });

    it('should sort by priority', async () => {
      // Priority sorting: high=1, medium=2, low=3
      // Ascending means high first (lower number)
      const tickets = await ticketService.listTickets({ sort: 'priority', order: 'asc' });

      expect(tickets[0].priority).toBe('high');
      expect(tickets[2].priority).toBe('low');
    });

    it('should combine filters and sorting', async () => {
      // Project A has: high (1) and medium (3)
      // Descending priority = low first (3, 2, 1) but no low in Project A
      // So descending = medium first, then high
      const tickets = await ticketService.listTickets({
        project: 'Project A',
        sort: 'priority',
        order: 'desc',
      });

      expect(tickets.length).toBe(2);
      expect(tickets[0].priority).toBe('medium');
      expect(tickets[1].priority).toBe('high');
    });

    it('should sort by updatedAt descending', async () => {
      // Create tickets with specific order
      const t1 = await ticketService.createTicket({ title: 'First' });
      await new Promise(resolve => setTimeout(resolve, 10));
      const t2 = await ticketService.createTicket({ title: 'Second' });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Update the first ticket to make it most recently updated
      await ticketService.updateTicket(t1.id, { title: 'First (updated)' });
      
      // Clean existing tickets and add our test tickets
      const files = await fs.readdir(testDir);
      for (const file of files) {
        if (!file.startsWith('TICK-00')) continue;
        const id = file.replace('.md', '');
        if (id !== t1.id && id !== t2.id) {
          await ticketService.deleteTicket(id);
        }
      }
      
      const tickets = await ticketService.listTickets({ sort: 'updatedAt', order: 'desc' });
      
      // First ticket should be first since it was updated last
      expect(tickets[0].id).toBe(t1.id);
      expect(tickets[1].id).toBe(t2.id);
    });
  });
});

describe('TicketService file format', () => {
  let ticketService: TicketService;
  let testDir: string;

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `mission-control-format-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    ticketService = new TicketService(testDir);
  });

  it('should preserve markdown content in body', async () => {
    const body = `
**Problem:**
Something is broken.

**Tasks:**
- [ ] Task 1
- [ ] Task 2

\`\`\`javascript
const x = 1;
\`\`\`
`;

    const created = await ticketService.createTicket({
      title: 'Markdown Test',
      body,
    });

    const retrieved = await ticketService.getTicket(created.id);
    expect(retrieved.body.trim()).toBe(body.trim());
  });

  it('should handle grooming status in frontmatter', async () => {
    const created = await ticketService.createTicket({
      title: 'Grooming Test',
    });

    await ticketService.updateTicket(created.id, {
      grooming: {
        status: 'complete',
        triggeredAt: '2026-02-06T10:00:00Z',
        completedAt: '2026-02-06T10:02:00Z',
        sessionKey: 'groom-TICK-001-1234567890',
        attempts: 1,
      },
    });

    const retrieved = await ticketService.getTicket(created.id);
    expect(retrieved.grooming?.status).toBe('complete');
    expect(retrieved.grooming?.completedAt).toBe('2026-02-06T10:02:00Z');
    expect(retrieved.grooming?.sessionKey).toBe('groom-TICK-001-1234567890');
  });
});
