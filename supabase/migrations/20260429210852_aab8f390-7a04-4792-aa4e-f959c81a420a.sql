ALTER TABLE public.vod_audits
ADD COLUMN IF NOT EXISTS vod_created_at TIMESTAMPTZ;