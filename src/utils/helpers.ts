/**
 * File: src/utils/helpers.ts
 * Purpose: Utility functions for tokens, validation, formatting, etc.
 */

import crypto from 'crypto';

export const generateToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

export const generateSessionToken = (): string => {
  return generateToken(32);
};

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const sanitizeInput = (input: string): string => {
  return input.trim().replace(/[<>]/g, '');
};

export const formatDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

export const calculatePercentage = (
  value: number, 
  total: number
): number => {
  if (total === 0) return 0;
  return Math.round((value / total) * 100 * 100) / 100;
};

export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};
