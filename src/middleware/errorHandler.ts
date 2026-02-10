import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { NotFoundError } from '../services/ticketService';

export interface ApiError {
  status: number;
  message: string;
  details?: unknown;
}

/**
 * Express error handling middleware
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(`[API Error] ${req.method} ${req.path}:`, error.message);

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid request data',
      details: error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });
    return;
  }

  // Handle not found errors
  if (error instanceof NotFoundError) {
    res.status(404).json({
      error: 'Not Found',
      message: error.message
    });
    return;
  }

  // Handle file system errors
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    res.status(404).json({
      error: 'Not Found',
      message: 'Resource not found'
    });
    return;
  }

  if ((error as NodeJS.ErrnoException).code === 'EACCES') {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied to resource'
    });
    return;
  }

  // Default to 500 internal server error
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : error.message
  });
}

/**
 * Async route handler wrapper to catch errors
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
