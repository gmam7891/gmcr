ALTER TABLE public.stream_snapshots 
ADD COLUMN IF NOT EXISTS is_ai_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_confidence numeric;