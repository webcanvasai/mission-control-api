import fs from 'fs/promises';
import path from 'path';
import { parseTicket, serializeTicket, generateNextTicketId } from '../utils/ticketParser';
import { Ticket, CreateTicketInput, UpdateTicketInput, ListTicketsQuery } from '../types/ticket';
import { priorityToNumber } from '../utils/ticketParser';

export class TicketService {
  constructor(private vaultPath: string) {}

  /**
   * List all tickets in the vault directory
   */
  async listTickets(query?: ListTicketsQuery): Promise<Ticket[]> {
    const files = await fs.readdir(this.vaultPath);
    const ticketFiles = files.filter(f => /^TICK-\d+\.md$/.test(f));
    
    const tickets: Ticket[] = [];
    
    for (const file of ticketFiles) {
      try {
        const filePath = path.join(this.vaultPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const ticket = parseTicket(filePath, content);
        tickets.push(ticket);
      } catch (error) {
        console.error(`Failed to parse ticket ${file}:`, error);
        // Skip invalid tickets but log the error
      }
    }

    // Apply filters
    let filtered = tickets;
    
    if (query?.status) {
      filtered = filtered.filter(t => t.status === query.status);
    }
    if (query?.priority) {
      filtered = filtered.filter(t => t.priority === query.priority);
    }
    if (query?.project) {
      filtered = filtered.filter(t => t.project === query.project);
    }
    if (query?.assignee) {
      filtered = filtered.filter(t => t.assignee === query.assignee);
    }

    // Apply sorting
    const sortField = query?.sort || 'id';
    const sortOrder = query?.order || 'asc';
    
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'priority':
          comparison = priorityToNumber(a.priority) - priorityToNumber(b.priority);
          break;
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'updatedAt':
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case 'id':
        default:
          const aNum = parseInt(a.id.replace('TICK-', ''), 10);
          const bNum = parseInt(b.id.replace('TICK-', ''), 10);
          comparison = aNum - bNum;
      }
      
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return filtered;
  }

  /**
   * Get a single ticket by ID
   */
  async getTicket(id: string): Promise<Ticket> {
    const filePath = path.join(this.vaultPath, `${id}.md`);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return parseTicket(filePath, content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError(`Ticket ${id} not found`);
      }
      throw error;
    }
  }

  /**
   * Create a new ticket
   */
  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    // Get existing ticket IDs to generate next ID
    const files = await fs.readdir(this.vaultPath);
    const existingIds = files
      .filter(f => /^TICK-\d+\.md$/.test(f))
      .map(f => f.replace('.md', ''));
    
    const id = generateNextTicketId(existingIds);
    const now = new Date().toISOString();
    
    const ticket: Ticket = {
      id,
      title: input.title,
      status: input.status || 'backlog',
      priority: input.priority || 'medium',
      project: input.project || 'Uncategorized',
      assignee: input.assignee,
      estimate: input.estimate,
      createdAt: now,
      updatedAt: now,
      grooming: undefined,
      body: input.body || '',
      filePath: path.join(this.vaultPath, `${id}.md`)
    };

    const content = serializeTicket(ticket);
    await fs.writeFile(ticket.filePath, content, 'utf-8');
    
    return ticket;
  }

  /**
   * Update an existing ticket
   */
  async updateTicket(id: string, updates: UpdateTicketInput): Promise<Ticket> {
    const existing = await this.getTicket(id);
    const now = new Date().toISOString();
    
    const updated: Ticket = {
      ...existing,
      ...updates,
      id: existing.id, // ID cannot be changed
      updatedAt: now,
      body: updates.body !== undefined ? updates.body : existing.body,
      filePath: existing.filePath
    };

    const content = serializeTicket(updated);
    await fs.writeFile(existing.filePath, content, 'utf-8');
    
    return updated;
  }

  /**
   * Delete a ticket
   */
  async deleteTicket(id: string): Promise<void> {
    const filePath = path.join(this.vaultPath, `${id}.md`);
    
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError(`Ticket ${id} not found`);
      }
      throw error;
    }
  }

  /**
   * Check if vault path exists
   */
  async healthCheck(): Promise<{ status: string; vaultPath: string; ticketCount: number }> {
    try {
      const files = await fs.readdir(this.vaultPath);
      const ticketCount = files.filter(f => /^TICK-\d+\.md$/.test(f)).length;
      
      return {
        status: 'healthy',
        vaultPath: this.vaultPath,
        ticketCount
      };
    } catch (error) {
      throw new Error(`Vault path not accessible: ${this.vaultPath}`);
    }
  }
}

/**
 * Custom error for not found resources
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
