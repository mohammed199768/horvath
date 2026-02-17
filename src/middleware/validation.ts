/**
 * File: src/middleware/validation.ts
 * Purpose: Request validation middleware using Zod
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodTypeAny } from 'zod';

export const validate = (schema: ZodTypeAny) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const envelope = {
        body: req.body,
        query: req.query,
        params: req.params,
      };

      let parsed: unknown;
      try {
        parsed = await schema.parseAsync(envelope);
      } catch {
        // Backward compatibility: allow existing body-only schemas.
        parsed = await schema.parseAsync(req.body);
      }

      if (parsed && typeof parsed === 'object') {
        const maybeEnvelope = parsed as { body?: unknown; query?: unknown; params?: unknown };
        if (typeof maybeEnvelope.body !== 'undefined') {
          req.body = maybeEnvelope.body;
        }
        if (typeof maybeEnvelope.query !== 'undefined') {
          req.query = maybeEnvelope.query as Request['query'];
        }
        if (typeof maybeEnvelope.params !== 'undefined') {
          req.params = maybeEnvelope.params as Request['params'];
        }
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(error);
    }
  };
};

export const schemas = {
  login: z.object({
    email: z.string().email(),
    password: z.string().min(6),
  }),

  participant: z.object({
    email: z.string().email(),
    full_name: z.string().min(2),
    company_name: z.string().min(2),
    job_title: z.string().optional(),
    industry: z.string().optional(),
    phone: z.string().optional(),
    company_size: z.string().optional(),
    country: z.string().optional(),
    consent_given: z.boolean(),
  }),

  topicResponse: z.object({
    topic_id: z.string().uuid(),
    current_rating: z.number().min(1).max(5),
    target_rating: z.number().min(1).max(5),
    time_spent_seconds: z.number().optional(),
    notes: z.string().optional(),
  }),
};
