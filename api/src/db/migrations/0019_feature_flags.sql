-- Migration: 0019_feature_flags
-- Implements spec 29: Feature Flags and Experiment Assignments

CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN DEFAULT false NOT NULL,
  org_id UUID[] DEFAULT '{}',
  type TEXT DEFAULT 'release' NOT NULL,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS experiment_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  experiment_name TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
