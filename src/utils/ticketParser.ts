import matter from 'gray-matter';
import { TicketMetadataSchema, Ticket } from '../types/ticket';
import { ZodError } from 'zod';

/**
 * Parse a markdown ticket file into a structured Ticket object
 */
export function parseTicket(filePath: string, content: string): Ticket {
  try {
    const { data, content: body } = matter(content);
    
    // Validate metadata with Zod
    const metadata = TicketMetadataSchema.parse(data);
    
    return {
      ...metadata,
      body: body.trim(),
      filePath
    };
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Invalid ticket metadata in ${filePath}: ${issues}`);
    }
    throw new Error(`Failed to parse ticket ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Serialize a ticket back to markdown with YAML frontmatter
 */
export function serializeTicket(ticket: Partial<Ticket> & { body?: string }): string {
  const { body, filePath, ...metadata } = ticket;
  
  // Remove undefined values from metadata (gray-matter doesn't like them)
  const cleanMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([_, v]) => v !== undefined)
  );
  
  // Build YAML frontmatter
  const frontmatter = matter.stringify(body || '', cleanMetadata);
  return frontmatter;
}

/**
 * Extract ticket ID from file path
 */
export function extractTicketId(filePath: string): string {
  const match = filePath.match(/TICK-\d+/);
  if (!match) {
    throw new Error(`Could not extract ticket ID from path: ${filePath}`);
  }
  return match[0];
}

/**
 * Generate the next ticket ID based on existing tickets
 */
export function generateNextTicketId(existingIds: string[]): string {
  const numbers = existingIds
    .map(id => {
      const match = id.match(/TICK-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(n => !isNaN(n));
  
  const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
  return `TICK-${String(maxNumber + 1).padStart(3, '0')}`;
}

/**
 * Priority sort order (high = 1, medium = 2, low = 3)
 */
export function priorityToNumber(priority: 'low' | 'medium' | 'high'): number {
  switch (priority) {
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default: return 2;
  }
}
