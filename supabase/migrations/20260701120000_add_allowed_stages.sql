-- Per-platform campaign stage entitlements.
-- Stored as JSONB keyed by platform: { "instagram": ["igaming", ...], "tiktok": [...], ... }.
-- NULL means "no restriction" (all stages) for backward compatibility with existing rows.

ALTER TABLE public.access_packages
  ADD COLUMN IF NOT EXISTS allowed_stages JSONB DEFAULT NULL;

ALTER TABLE public.user_access
  ADD COLUMN IF NOT EXISTS allowed_stages JSONB DEFAULT NULL;
