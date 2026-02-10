import { Ticket, GroomingStatus } from '../types/ticket';
import { TicketService } from './ticketService';
import config from '../config';

/**
 * Grooming Service
 * Handles auto-grooming detection and OpenClaw gateway integration
 */
export class GroomingService {
  // Track in-flight grooming sessions to prevent duplicates
  private activeGroomingSessions: Map<string, { sessionKey: string; startedAt: Date }> = new Map();
  
  // Retry configuration
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 5000;
  
  constructor(private ticketService: TicketService) {}

  /**
   * Determine if a ticket should be auto-groomed
   * Returns true if ALL conditions are met:
   * - Status is 'backlog' or doesn't have estimate
   * - Content < 500 chars OR missing "Implementation Details"
   * - Created within last 5 minutes
   * - Not already being groomed
   */
  shouldAutoGroom(ticket: Ticket): boolean {
    // 1. Check grooming status - skip if already in progress
    if (ticket.grooming?.status === 'in-progress' || ticket.grooming?.status === 'pending') {
      console.log(`[Grooming] Skipping ${ticket.id}: already ${ticket.grooming.status}`);
      return false;
    }

    // Check if already being processed locally
    if (this.activeGroomingSessions.has(ticket.id)) {
      console.log(`[Grooming] Skipping ${ticket.id}: active local session`);
      return false;
    }

    // 2. Check status - must be backlog or missing estimate
    const isBacklog = ticket.status === 'backlog';
    const missingEstimate = ticket.estimate === undefined || ticket.estimate === null;
    
    if (!isBacklog && !missingEstimate) {
      console.log(`[Grooming] Skipping ${ticket.id}: not backlog and has estimate`);
      return false;
    }

    // 3. Check content quality - minimal content check
    const contentLength = ticket.body?.length || 0;
    const hasImplementationDetails = ticket.body?.includes('Implementation Details') || 
                                      ticket.body?.includes('**Implementation');
    
    if (contentLength >= 500 && hasImplementationDetails) {
      console.log(`[Grooming] Skipping ${ticket.id}: content looks complete (${contentLength} chars, has Implementation Details)`);
      return false;
    }

    // 4. Check if created recently (within 5 minutes)
    const createdAt = new Date(ticket.createdAt);
    const now = new Date();
    const ageMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);
    
    if (ageMinutes > 5) {
      console.log(`[Grooming] Skipping ${ticket.id}: too old (${ageMinutes.toFixed(1)} minutes)`);
      return false;
    }

    // 5. Check if recently groomed (within 10 minutes) - prevent re-grooming loops
    if (ticket.grooming?.completedAt) {
      const completedAt = new Date(ticket.grooming.completedAt);
      const completedAgeMinutes = (now.getTime() - completedAt.getTime()) / (1000 * 60);
      
      if (completedAgeMinutes < 10) {
        console.log(`[Grooming] Skipping ${ticket.id}: recently groomed (${completedAgeMinutes.toFixed(1)} minutes ago)`);
        return false;
      }
    }

    console.log(`[Grooming] ${ticket.id} qualifies for auto-grooming:`);
    console.log(`  - Status: ${ticket.status}, Estimate: ${ticket.estimate ?? 'none'}`);
    console.log(`  - Content: ${contentLength} chars, Has impl details: ${hasImplementationDetails}`);
    console.log(`  - Age: ${ageMinutes.toFixed(1)} minutes`);
    
    return true;
  }

  /**
   * Calculate a grooming quality score (0-100)
   */
  calculateGroomingScore(ticket: Ticket): number {
    let score = 0;
    
    if (ticket.estimate) score += 20;
    if (ticket.body?.includes('**Tasks:**') || ticket.body?.includes('## Tasks')) score += 15;
    if (ticket.body?.includes('**Acceptance Criteria:**') || ticket.body?.includes('## Acceptance')) score += 20;
    if (ticket.body?.includes('**Dependencies:**') || ticket.body?.includes('## Dependencies')) score += 15;
    if (ticket.body?.includes('**Success Metrics:**') || ticket.body?.includes('## Success')) score += 10;
    if (ticket.body?.includes('**Implementation') || ticket.body?.includes('## Implementation')) score += 10;
    if ((ticket.body?.length || 0) > 2000) score += 10;
    
    return score;
  }

  /**
   * Trigger grooming for a ticket via OpenClaw CLI
   * Uses `openclaw agent` command to spawn grooming agent
   */
  async triggerGrooming(ticketId: string, ticket: Ticket): Promise<{ success: boolean; sessionKey?: string; error?: string }> {
    // Mark as pending and track locally
    await this.markGroomingStatus(ticketId, {
      status: 'pending',
      triggeredAt: new Date().toISOString(),
      attempts: (ticket.grooming?.attempts || 0) + 1
    });

    let lastError: string = '';
    const sessionKey = `groom-${ticketId}-${Date.now()}`;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[Grooming] Triggering grooming for ${ticketId} (attempt ${attempt}/${this.maxRetries})`);
        
        const task = this.buildGroomingTask(ticketId, ticket);
        
        // Use OpenClaw CLI to spawn the grooming agent
        const result = await this.runOpenClawAgent(ticketId, task);
        
        if (result.success) {
          console.log(`[Grooming] Successfully triggered grooming for ${ticketId}`);
          
          // Track the active session
          this.activeGroomingSessions.set(ticketId, {
            sessionKey,
            startedAt: new Date()
          });

          // Update ticket to in-progress
          await this.markGroomingStatus(ticketId, {
            status: 'in-progress',
            triggeredAt: new Date().toISOString(),
            sessionKey,
            attempts: ticket.grooming?.attempts || 1
          });

          // Set up timeout to clean up stale sessions
          this.scheduleSessionCleanup(ticketId, sessionKey);

          return { success: true, sessionKey };
        } else {
          throw new Error(result.error || 'Agent execution failed');
        }
        
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`[Grooming] Attempt ${attempt} failed for ${ticketId}:`, lastError);
        
        if (attempt < this.maxRetries) {
          console.log(`[Grooming] Retrying in ${this.retryDelayMs}ms...`);
          await this.delay(this.retryDelayMs);
        }
      }
    }

    // All retries exhausted
    console.error(`[Grooming] All retries exhausted for ${ticketId}`);
    
    await this.markGroomingStatus(ticketId, {
      status: 'failed',
      lastError,
      attempts: (ticket.grooming?.attempts || 0) + 1
    });

    return { success: false, error: lastError };
  }

  /**
   * Run OpenClaw agent via HTTP API
   * This uses the OpenClaw gateway's /tools/invoke endpoint with sessions_spawn
   */
  private async runOpenClawAgent(ticketId: string, task: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[Grooming] Spawning OpenClaw agent for ${ticketId} via HTTP`);
      
      if (!config.openclawToken) {
        throw new Error('OpenClaw token not configured - cannot spawn grooming agent');
      }
      
      const url = `${config.openclawGatewayUrl}/tools/invoke`;
      const payload = {
        tool: 'sessions_spawn',
        args: {
          agentId: 'grooming',
          label: `groom-${ticketId}`,
          task,
          cleanup: 'keep',
          runTimeoutSeconds: 300 // 5 minute timeout
        }
      };
      
      console.log(`[Grooming] Gateway URL: ${url}`);
      console.log(`[Grooming] Request:`, JSON.stringify(payload).substring(0, 200) + '...');
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openclawToken}`
        },
        body: JSON.stringify(payload)
      });
      
      console.log(`[Grooming] Response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gateway returned ${response.status}: ${errorText}`);
      }
      
      const result = await response.json();
      
      if (!result.ok) {
        throw new Error(`Gateway error: ${result.error?.message || JSON.stringify(result.error)}`);
      }
      
      console.log(`[Grooming] Successfully spawned grooming agent for ${ticketId}`);
      console.log(`[Grooming] Session: ${result.result?.childSessionKey || 'unknown'}`);
      
      return { success: true };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error(`[Grooming] Failed to spawn agent for ${ticketId}:`, errorMsg);
      if (errorStack) {
        console.error(`[Grooming] Stack trace:`, errorStack);
      }
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Build the grooming task prompt
   */
  private buildGroomingTask(ticketId: string, ticket: Ticket): string {
    return `Groom ticket ${ticketId}: "${ticket.title}"

Read the ticket file at: /home/chris/Kolenko/Mission Control/tickets/${ticketId}.md

This ticket needs grooming. Please:
1. Read the current ticket content
2. Load relevant project context from your context/ directory
3. Expand the ticket with:
   - Technical implementation details (phased approach)
   - Detailed acceptance criteria (testable)
   - Dependencies on other tickets/systems
   - Story point estimate (1, 2, 3, 5, 8, 13)
   - Success metrics
   - Edge cases to consider
4. Update the ticket file with the groomed content
5. Set grooming.status to 'complete' and add grooming.completedAt timestamp

Current ticket info:
- Project: ${ticket.project}
- Status: ${ticket.status}
- Priority: ${ticket.priority}
- Current content length: ${ticket.body?.length || 0} chars

Remember: Be thorough but practical. Add real value, not fluff.`;
  }

  /**
   * Update grooming status in ticket frontmatter
   */
  async markGroomingStatus(ticketId: string, status: Partial<GroomingStatus>): Promise<void> {
    try {
      const ticket = await this.ticketService.getTicket(ticketId);
      
      const newGrooming: GroomingStatus = {
        ...(ticket.grooming || {}),
        ...status
      } as GroomingStatus;

      await this.ticketService.updateTicket(ticketId, { grooming: newGrooming });
      
      console.log(`[Grooming] Updated ${ticketId} grooming status to: ${newGrooming.status}`);
    } catch (error) {
      console.error(`[Grooming] Failed to update grooming status for ${ticketId}:`, error);
    }
  }

  /**
   * Mark grooming as complete (called when grooming agent finishes)
   */
  async markGroomingComplete(ticketId: string): Promise<void> {
    this.activeGroomingSessions.delete(ticketId);
    
    await this.markGroomingStatus(ticketId, {
      status: 'complete',
      completedAt: new Date().toISOString()
    });
  }

  /**
   * Mark grooming as failed (called on errors or timeout)
   */
  async markGroomingFailed(ticketId: string, error: string): Promise<void> {
    this.activeGroomingSessions.delete(ticketId);
    
    await this.markGroomingStatus(ticketId, {
      status: 'failed',
      lastError: error
    });
  }

  /**
   * Schedule cleanup for stale grooming sessions
   */
  private scheduleSessionCleanup(ticketId: string, sessionKey: string): void {
    // Clean up after 10 minutes if still marked as in-progress
    setTimeout(async () => {
      const session = this.activeGroomingSessions.get(ticketId);
      
      if (session && session.sessionKey === sessionKey) {
        console.log(`[Grooming] Session timeout for ${ticketId} - checking status`);
        
        try {
          const ticket = await this.ticketService.getTicket(ticketId);
          
          // Check if it's still in-progress (grooming agent might have finished but we missed the update)
          if (ticket.grooming?.status === 'in-progress') {
            // Check if content was actually updated (grooming succeeded but status wasn't updated)
            const score = this.calculateGroomingScore(ticket);
            
            if (score >= 60) {
              console.log(`[Grooming] ${ticketId} appears groomed (score=${score}) - marking complete`);
              await this.markGroomingComplete(ticketId);
            } else {
              console.log(`[Grooming] ${ticketId} still incomplete (score=${score}) - marking failed`);
              await this.markGroomingFailed(ticketId, 'Session timeout');
            }
          }
        } catch (error) {
          console.error(`[Grooming] Error during session cleanup for ${ticketId}:`, error);
        }
        
        this.activeGroomingSessions.delete(ticketId);
      }
    }, 10 * 60 * 1000); // 10 minutes
  }

  /**
   * Check and potentially trigger grooming for a newly created ticket
   */
  async handleNewTicket(filePath: string): Promise<void> {
    // Extract ticket ID from file path
    const match = filePath.match(/TICK-\d+/);
    if (!match) {
      console.log(`[Grooming] Invalid ticket path: ${filePath}`);
      return;
    }
    
    const ticketId = match[0];
    
    // Small delay to ensure file is fully written
    await this.delay(500);
    
    try {
      const ticket = await this.ticketService.getTicket(ticketId);
      
      if (this.shouldAutoGroom(ticket)) {
        console.log(`[Grooming] Auto-grooming ${ticketId}`);
        await this.triggerGrooming(ticketId, ticket);
      }
    } catch (error) {
      console.error(`[Grooming] Error handling new ticket ${ticketId}:`, error);
    }
  }

  /**
   * Get active grooming sessions (for monitoring)
   */
  getActiveGroomingSessions(): Map<string, { sessionKey: string; startedAt: Date }> {
    return new Map(this.activeGroomingSessions);
  }

  /**
   * Manually trigger grooming for a ticket (bypass auto-groom checks)
   */
  async manualGroom(ticketId: string): Promise<{ success: boolean; sessionKey?: string; error?: string }> {
    try {
      const ticket = await this.ticketService.getTicket(ticketId);
      
      // Check if already in progress
      if (ticket.grooming?.status === 'in-progress' || this.activeGroomingSessions.has(ticketId)) {
        return { success: false, error: 'Grooming already in progress' };
      }
      
      return await this.triggerGrooming(ticketId, ticket);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
