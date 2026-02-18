/**
 * File: src/routes/public/participants.ts
 * Purpose: Participant registration and management
 */

import { Router } from 'express';
import { query } from '../../config/database';
import { logger } from '../../utils/logger';
import { z } from 'zod';
import crypto from 'crypto';

const router = Router();

// Zod schema for participant validation
const createParticipantSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  companyName: z.string().optional(),
  jobTitle: z.string().optional(),
  phone: z.string().optional(),
  industry: z.string().optional(),
  companySize: z.string().optional(),
  country: z.string().optional(),
  consentGiven: z.boolean(),
});

router.post('/', async (req, res, next) => {
  try {
    // Validate request body
    const validated = createParticipantSchema.parse(req.body);

    if (!validated.consentGiven) {
      return res.status(400).json({ 
        success: false,
        error: 'Consent is required to participate' 
      });
    }

    // Check if participant exists
    const existingCheck = await query(
      'SELECT id, email, full_name, company_name, participant_token FROM participants WHERE email = $1',
      [validated.email]
    );

    if (existingCheck.rows.length > 0) {
      const existing = existingCheck.rows[0];

      const tokenToUse =
        typeof existing.participant_token === 'string' && existing.participant_token.length > 0
          ? existing.participant_token
          : crypto.randomBytes(32).toString('hex');
      
      // Update existing participant info to capture latest details
      await query(
        `UPDATE participants 
         SET full_name = $1, company_name = $2, job_title = $3, 
             industry = $4, phone = $5, company_size = $6, 
             country = $7, participant_token = $8, updated_at = NOW()
         WHERE id = $9`,
        [
          validated.fullName,
          validated.companyName || null,
          validated.jobTitle || null,
          validated.industry || null,
          validated.phone || null,
          validated.companySize || null,
          validated.country || null,
          tokenToUse,
          existing.id,
        ]
      );

      return res.status(200).json({
        success: true,
        data: {
          participantId: existing.id,
          email: existing.email,
          fullName: validated.fullName,
          participantToken: tokenToUse,
          message: 'Participant updated successfully',
        },
      });
    }

    // Create new participant
    const participantToken = crypto.randomBytes(32).toString('hex');
    const result = await query(
      `INSERT INTO participants 
       (email, full_name, company_name, job_title, phone, industry, company_size, country, consent_given, consent_date, participant_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, $10)
       RETURNING id, email, full_name`,
      [
        validated.email,
        validated.fullName,
        validated.companyName || null,
        validated.jobTitle || null,
        validated.phone || null,
        validated.industry || null,
        validated.companySize || null,
        validated.country || null,
        validated.consentGiven,
        participantToken,
      ]
    );

    const participant = result.rows[0];

    logger.info(`New participant created: ${participant.email}`);

    res.status(201).json({
      success: true,
      data: {
        participantId: participant.id,
        email: participant.email,
        fullName: participant.full_name,
        participantToken,
      },
    });
  } catch (error: any) {
    logger.error('Error creating participant:', error);

    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }

    next(error);
  }
});

export default router;
