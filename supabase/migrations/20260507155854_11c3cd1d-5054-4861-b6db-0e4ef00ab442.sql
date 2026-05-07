
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vod_id TEXT NOT NULL,
  streamer_login TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  cursor_mosaic INTEGER NOT NULL DEFAULT 0,
  total_mosaics INTEGER NOT NULL DEFAULT 0,
  total_tiles INTEGER NOT NULL DEFAULT 0,
  processed_tiles INTEGER NOT NULL DEFAULT 0,
  detections_count INTEGER NOT NULL DEFAULT 0,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  message TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_vod ON public.agent_runs(vod_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON public.agent_runs(status);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read agent_runs"
  ON public.agent_runs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage agent_runs"
  ON public.agent_runs FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
