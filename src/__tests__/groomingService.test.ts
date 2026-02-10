import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GroomingService } from '../services/groomingService';
import { Ticket, GroomingStatus } from '../types/ticket';

// Mock the ticket service
const mockTicketService = {
  getTicket: vi.fn(),
  updateTicket: vi.fn(),
  listTickets: vi.fn(),
  createTicket: vi.fn(),
  deleteTicket: vi.fn(),
  healthCheck: vi.fn(),
};

describe('GroomingService', () => {
  let groomingService: GroomingService;

  beforeEach(() => {
    vi.clearAllMocks();
    groomingService = new GroomingService(mockTicketService as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shouldAutoGroom', () => {
    const createTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
      id: 'TICK-001',
      title: 'Test Ticket',
      status: 'backlog',
      priority: 'medium',
      project: 'Test Project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      body: 'Brief description',
      filePath: '/test/TICK-001.md',
      ...overrides,
    });

    it('should return true for minimal backlog ticket', () => {
      const ticket = createTicket({
        status: 'backlog',
        body: 'Brief problem description',
      });

      expect(groomingService.shouldAutoGroom(ticket)).toBe(true);
    });

    it('should return false if grooming is already in progress', () => {
      const ticket = createTicket({
        grooming: { status: 'in-progress' },
      });

      expect(groomingService.shouldAutoGroom(ticket)).toBe(false);
    });

    it('should return false if grooming is pending', () => {
      const ticket = createTicket({
        grooming: { status: 'pending' },
      });

      expect(groomingService.shouldAutoGroom(ticket)).toBe(false);
    });

    it('should return false for detailed ticket with estimate and implementation details', () => {
      const detailedBody = `
**Problem:**
Some issue that needs fixing.

**Implementation Details:**
1. Step one
2. Step two
3. Step three

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2
`.repeat(5); // Make it > 500 chars

      const ticket = createTicket({
        status: 'backlog',
        estimate: 5,
        body: detailedBody,
      });

      expect(groomingService.shouldAutoGroom(ticket)).toBe(false);
    });

    it('should return false for ticket not in backlog status with estimate', () => {
      const ticket = createTicket({
        status: 'in-progress',
        estimate: 3,
      });

      expect(groomingService.shouldAutoGroom(ticket)).toBe(false);
    });

    it('should return true for ticket without estimate even if in-progress', () => {
      const ticket = createTicket({
        status: 'in-progress',
        estimate: undefined,
      });

      expect(groomingService.shouldAutoGroom(ticket)).toBe(true);
    });

    it('should return false for old tickets (> 5 minutes)', () => {
      const oldDate = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
      const ticket = createTicket({
        createdAt: oldDate,
      });

      expect(groomingService.shouldAutoGroom(ticket)).toBe(false);
    });

    it('should return false for recently groomed tickets (within 10 minutes)', () => {
      const ticket = createTicket({
        grooming: {
          status: 'complete',
          completedAt: new Date().toISOString(),
        },
      });

      expect(groomingService.shouldAutoGroom(ticket)).toBe(false);
    });
  });

  describe('calculateGroomingScore', () => {
    it('should return 0 for empty ticket', () => {
      const ticket: Ticket = {
        id: 'TICK-001',
        title: 'Empty',
        status: 'backlog',
        priority: 'medium',
        project: 'Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: '',
        filePath: '/test/TICK-001.md',
      };

      expect(groomingService.calculateGroomingScore(ticket)).toBe(0);
    });

    it('should add 20 points for estimate', () => {
      const ticket: Ticket = {
        id: 'TICK-001',
        title: 'Test',
        status: 'backlog',
        priority: 'medium',
        project: 'Test',
        estimate: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: '',
        filePath: '/test/TICK-001.md',
      };

      expect(groomingService.calculateGroomingScore(ticket)).toBe(20);
    });

    it('should add 15 points for Tasks section', () => {
      const ticket: Ticket = {
        id: 'TICK-001',
        title: 'Test',
        status: 'backlog',
        priority: 'medium',
        project: 'Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: '**Tasks:**\n- [ ] Task 1\n- [ ] Task 2',
        filePath: '/test/TICK-001.md',
      };

      expect(groomingService.calculateGroomingScore(ticket)).toBe(15);
    });

    it('should add 20 points for Acceptance Criteria section', () => {
      const ticket: Ticket = {
        id: 'TICK-001',
        title: 'Test',
        status: 'backlog',
        priority: 'medium',
        project: 'Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: '**Acceptance Criteria:**\n- [ ] AC 1\n- [ ] AC 2',
        filePath: '/test/TICK-001.md',
      };

      expect(groomingService.calculateGroomingScore(ticket)).toBe(20);
    });

    it('should add 15 points for Dependencies section', () => {
      const ticket: Ticket = {
        id: 'TICK-001',
        title: 'Test',
        status: 'backlog',
        priority: 'medium',
        project: 'Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: '**Dependencies:**\n- TICK-002',
        filePath: '/test/TICK-001.md',
      };

      expect(groomingService.calculateGroomingScore(ticket)).toBe(15);
    });

    it('should add 10 points for Success Metrics section', () => {
      const ticket: Ticket = {
        id: 'TICK-001',
        title: 'Test',
        status: 'backlog',
        priority: 'medium',
        project: 'Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: '**Success Metrics:**\n- Metric 1',
        filePath: '/test/TICK-001.md',
      };

      expect(groomingService.calculateGroomingScore(ticket)).toBe(10);
    });

    it('should add 10 points for Implementation Details section', () => {
      const ticket: Ticket = {
        id: 'TICK-001',
        title: 'Test',
        status: 'backlog',
        priority: 'medium',
        project: 'Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: '**Implementation Details:**\n- Step 1',
        filePath: '/test/TICK-001.md',
      };

      expect(groomingService.calculateGroomingScore(ticket)).toBe(10);
    });

    it('should add 10 points for content > 2000 chars', () => {
      const ticket: Ticket = {
        id: 'TICK-001',
        title: 'Test',
        status: 'backlog',
        priority: 'medium',
        project: 'Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: 'x'.repeat(2500),
        filePath: '/test/TICK-001.md',
      };

      expect(groomingService.calculateGroomingScore(ticket)).toBe(10);
    });

    it('should calculate full score (100) for complete ticket', () => {
      const ticket: Ticket = {
        id: 'TICK-001',
        title: 'Complete Ticket',
        status: 'backlog',
        priority: 'medium',
        project: 'Test',
        estimate: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: `
**Problem:**
Something needs fixing.

**Tasks:**
- [ ] Task 1
- [ ] Task 2

**Acceptance Criteria:**
- [ ] AC 1
- [ ] AC 2

**Dependencies:**
- TICK-002

**Success Metrics:**
- Metric 1
- Metric 2

**Implementation Details:**
Phase 1: Setup
Phase 2: Build
Phase 3: Test

${' '.repeat(2000)}
`,
        filePath: '/test/TICK-001.md',
      };

      expect(groomingService.calculateGroomingScore(ticket)).toBe(100);
    });

    it('should recognize alternative markdown headers (##)', () => {
      const ticket: Ticket = {
        id: 'TICK-001',
        title: 'Test',
        status: 'backlog',
        priority: 'medium',
        project: 'Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: `
## Tasks
- Task 1

## Acceptance Criteria
- AC 1

## Dependencies
- None

## Success Metrics
- Metric 1

## Implementation
- Step 1
`,
        filePath: '/test/TICK-001.md',
      };

      // Tasks (15) + Acceptance (20) + Dependencies (15) + Success (10) + Implementation (10) = 70
      expect(groomingService.calculateGroomingScore(ticket)).toBe(70);
    });
  });

  describe('getActiveGroomingSessions', () => {
    it('should return empty map initially', () => {
      const sessions = groomingService.getActiveGroomingSessions();
      expect(sessions.size).toBe(0);
    });
  });

  describe('manualGroom', () => {
    it('should fail if ticket does not exist', async () => {
      mockTicketService.getTicket.mockRejectedValue(new Error('Ticket not found'));

      const result = await groomingService.manualGroom('TICK-999');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket not found');
    });

    it('should fail if grooming already in progress', async () => {
      mockTicketService.getTicket.mockResolvedValue({
        id: 'TICK-001',
        grooming: { status: 'in-progress' },
      });

      const result = await groomingService.manualGroom('TICK-001');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Grooming already in progress');
    });
  });
});

describe('GroomingService Integration', () => {
  describe('Auto-groom workflow scenarios', () => {
    it('scenario: minimal ticket should trigger auto-groom', () => {
      const groomingService = new GroomingService(mockTicketService as any);
      
      // Create minimal ticket (simulating what happens when user creates via API)
      const minimalTicket: Ticket = {
        id: 'TICK-050',
        title: 'Add dark mode support',
        status: 'backlog',
        priority: 'medium',
        project: 'Mission Control',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: '**Problem:**\nUsers want dark mode.\n\n**Context:**\nUI request.',
        filePath: '/test/TICK-050.md',
      };

      // Should qualify for auto-grooming
      expect(groomingService.shouldAutoGroom(minimalTicket)).toBe(true);
      
      // Score should be low
      expect(groomingService.calculateGroomingScore(minimalTicket)).toBeLessThan(30);
    });

    it('scenario: detailed ticket should NOT trigger auto-groom', () => {
      const groomingService = new GroomingService(mockTicketService as any);
      
      // Well-groomed ticket
      const detailedTicket: Ticket = {
        id: 'TICK-051',
        title: 'Implement caching layer',
        status: 'backlog',
        priority: 'high',
        project: 'Mission Control',
        estimate: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: `
**Problem:**
API responses are slow, need caching.

**Implementation Details:**
Phase 1: Add Redis connection
Phase 2: Implement cache middleware
Phase 3: Add cache invalidation

**Tasks:**
- [ ] Set up Redis
- [ ] Create cache service
- [ ] Add middleware
- [ ] Write tests

**Acceptance Criteria:**
- [ ] 50% reduction in API latency
- [ ] Cache invalidation works correctly
- [ ] Tests pass with >80% coverage

**Dependencies:**
- Redis server available
- TICK-040 (API server)

**Success Metrics:**
- API latency < 100ms for cached requests
- Cache hit rate > 60%
`,
        filePath: '/test/TICK-051.md',
      };

      // Should NOT trigger auto-grooming
      expect(groomingService.shouldAutoGroom(detailedTicket)).toBe(false);
      
      // Score should be high
      expect(groomingService.calculateGroomingScore(detailedTicket)).toBeGreaterThanOrEqual(70);
    });

    it('scenario: failed grooming should mark status as failed', async () => {
      const groomingService = new GroomingService(mockTicketService as any);
      
      const ticket: Ticket = {
        id: 'TICK-052',
        title: 'Test ticket',
        status: 'backlog',
        priority: 'medium',
        project: 'Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        body: 'Minimal content',
        filePath: '/test/TICK-052.md',
      };

      mockTicketService.getTicket.mockResolvedValue(ticket);
      mockTicketService.updateTicket.mockResolvedValue(ticket);

      // Mark failed
      await groomingService.markGroomingFailed('TICK-052', 'Agent timeout');

      expect(mockTicketService.updateTicket).toHaveBeenCalledWith('TICK-052', {
        grooming: expect.objectContaining({
          status: 'failed',
          lastError: 'Agent timeout',
        }),
      });
    });
  });
});
