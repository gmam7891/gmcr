
-- Table: streamers being monitored
CREATE TABLE public.monitored_streamers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login TEXT NOT NULL UNIQUE,
  display_name TEXT,
  twitch_id TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: viewer snapshots per poll
CREATE TABLE public.stream_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_login TEXT NOT NULL REFERENCES public.monitored_streamers(login) ON DELETE CASCADE,
  viewer_count INTEGER NOT NULL DEFAULT 0,
  game_name TEXT,
  game_id TEXT,
  stream_title TEXT,
  is_live BOOLEAN NOT NULL DEFAULT false,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast queries by streamer + time
CREATE INDEX idx_snapshots_streamer_time ON public.stream_snapshots(streamer_login, captured_at DESC);
CREATE INDEX idx_snapshots_game ON public.stream_snapshots(game_name, captured_at DESC);

-- Disable RLS for now (internal tool, no user auth yet)
ALTER TABLE public.monitored_streamers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_snapshots ENABLE ROW LEVEL SECURITY;

-- Allow all operations (tool is internal, no public exposure)
CREATE POLICY "Allow all on monitored_streamers" ON public.monitored_streamers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on stream_snapshots" ON public.stream_snapshots FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for snapshots
ALTER PUBLICATION supabase_realtime ADD TABLE public.stream_snapshots;
