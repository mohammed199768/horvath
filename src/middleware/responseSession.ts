import { NextFunction, Request, Response } from 'express';
import { query } from '../config/database';
import { logger } from '../utils/logger';

const INVALID_SESSION_MESSAGE = 'Invalid session';

export const requireResponseSession = async (req: Request, res: Response, next: NextFunction) => {
  const { responseId } = req.params;
  const sessionToken = req.header('x-session-token');

  if (!sessionToken) {
    return res.status(401).json({ success: false, error: INVALID_SESSION_MESSAGE });
  }

  try {
    const result = await query(
      `SELECT id
       FROM assessment_responses
       WHERE id = $1
         AND session_token = $2`,
      [responseId, sessionToken]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ success: false, error: INVALID_SESSION_MESSAGE });
    }

    return next();
  } catch (error) {
    logger.error('Failed to validate participant response session', error);
    return next(error);
  }
};
