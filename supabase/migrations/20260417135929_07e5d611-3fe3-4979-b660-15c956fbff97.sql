-- Add live progress tracking columns to vod_audits
ALTER TABLE public.vod_audits
  ADD COLUMN IF NOT EXISTS progress_current_minute integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_total_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_games_found integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_phase text DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS progress_message text,
  ADD COLUMN IF NOT EXISTS pending_audit_segments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sullygnome_snapshot jsonb DEFAULT '{}'::jsonb;

-- Enable Realtime for vod_audits
ALTER PUBLICATION supabase_realtime ADD TABLE public.vod_audits;

-- Make sure the table emits full row on updates so the client gets new progress fields
ALTER TABLE public.vod_audits REPLICA IDENTITY FULL;

-- Add INSERT/UPDATE policy so service role can write progress (RLS already restricts to admins via existing policy; this UPDATE needs no extra policy because admins manage policy already covers it)