import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Middleware factory for validating request body
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware factory for validating query parameters
 * Parsed result is stored in res.locals.query
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.query = schema.parse(req.query);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Validate ticket ID parameter format
 */
export function validateTicketId(req: Request, res: Response, next: NextFunction) {
  const id = req.params.id as string;
  
  if (!id || !/^TICK-\d+$/.test(id)) {
    res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid ticket ID format. Expected: TICK-XXX'
    });
    return;
  }
  
  next();
}
