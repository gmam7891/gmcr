-- Add SSoT columns to stream_snapshots
ALTER TABLE public.stream_snapshots
  ADD COLUMN IF NOT EXISTS vod_id text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS provider_detected text,
  ADD COLUMN IF NOT EXISTS game_detected text,
  ADD COLUMN IF NOT EXISTS confidence_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frame_index integer,
  ADD COLUMN IF NOT EXISTS timestamp_seconds integer,
  ADD COLUMN IF NOT EXISTS extra_metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS processing_batch_id text;

CREATE INDEX IF NOT EXISTS idx_stream_snapshots_vod_id 
  ON public.stream_snapshots(vod_id) 
  WHERE vod_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stream_snapshots_streamer_captured 
  ON public.stream_snapshots(streamer_login, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_stream_snapshots_source_game 
  ON public.stream_snapshots(source, game_detected) 
  WHERE game_detected IS NOT NULL;

-- Watchdog + reconciliation columns on vod_audits
ALTER TABLE public.vod_audits
  ADD COLUMN IF NOT EXISTS last_checkpoint_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reconciliation_notes text;