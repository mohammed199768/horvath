/**
 * File: src/services/authService.ts
 * Purpose: Handles authentication, login, logout, and session management
 */

import bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { query } from '../config/database';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { validatePasswordStrength } from '../utils/passwordValidator';

export const AUTH_FAIL_MSG = 'Invalid credentials';

export class AuthService {
  /**
   * Authenticates user and creates session
   */
  static async login(email: string, password: string, ip: string, userAgent: string) {
    const userResult = await query(
      `SELECT id, email, password_hash, full_name, role, is_active, 
              login_attempts, locked_until
       FROM users
       WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      throw new Error(AUTH_FAIL_MSG);
    }

    const user = userResult.rows[0];

    // Check account lock
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      logger.warn(`Login attempt on locked account: ${email}`);
      throw new Error(AUTH_FAIL_MSG);
    }

    if (!user.is_active) {
      logger.warn(`Login attempt on deactivated account: ${email}`);
      throw new Error(AUTH_FAIL_MSG);
    }

    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      const lockUpdateResult = await query(
        `UPDATE users
         SET
           login_attempts = login_attempts + 1,
           locked_until = CASE
             WHEN login_attempts + 1 >= 5
             THEN NOW() + INTERVAL '30 minutes'
             ELSE locked_until
           END
         WHERE email = $1
         RETURNING locked_until, login_attempts`,
        [email]
      );

      if (lockUpdateResult.rows.length > 0 && lockUpdateResult.rows[0].locked_until) {
        logger.warn(`Account lockout triggered for ${email}`);
      }

      throw new Error(AUTH_FAIL_MSG);
    }

    // Reset attempts and update login time
    await query(
      `UPDATE users 
       SET login_attempts = 0, locked_until = NULL, last_login_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'] }
    );

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await query(
      `INSERT INTO admin_sessions (user_id, token, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, token, ip, userAgent, expiresAt]
    );

    logger.info(`User logged in: ${user.email}`);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
    };
  }

  static async logout(token: string) {
    await query('DELETE FROM admin_sessions WHERE token = $1', [token]);
    logger.info('User logged out');
  }

  static async verifyToken(token: string) {
    const result = await query(
      `SELECT s.*, u.email, u.full_name, u.role
       FROM admin_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  }

  static async createUser(
    email: string,
    password: string,
    fullName: string,
    role: string = 'admin'
  ) {
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.isStrong) {
      throw new Error(`Weak password: ${passwordCheck.feedback.join('; ')}`);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role`,
      [email, hashedPassword, fullName, role]
    );

    logger.info(`New user created: ${email}`);

    return result.rows[0];
  }
}
