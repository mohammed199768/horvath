/**
 * File: src/types/index.ts
 * Purpose: Common type definitions for the application
 */

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  last_login_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Assessment {
  id: string;
  title: string;
  description?: string;
  version: number;
  is_active: boolean;
  is_published: boolean;
  published_at?: Date;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface Dimension {
  id: string;
  assessment_id: string;
  dimension_key: string;
  title: string;
  description?: string;
  category: string;
  order_index: number;
}

export interface Topic {
  id: string;
  dimension_id: string;
  topic_key: string;
  label: string;
  prompt: string;
  order_index: number;
  help_text?: string;
  example?: string;
}

export interface Participant {
  id: string;
  email: string;
  full_name: string;
  company_name?: string;
  job_title?: string;
  industry?: string;
  phone?: string;
  company_size?: string;
  country?: string;
  consent_given: boolean;
  consent_date?: Date;
}
