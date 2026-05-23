CREATE TABLE public.agent_detection_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID,
  vod_id TEXT NOT NULL,
  streamer_login TEXT,
  mosaic_index INTEGER,
  row_index INTEGER,
  col_index INTEGER,
  frame_ts_seconds INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  screen_state TEXT,
  reported_game_name TEXT,
  matched_game_library_id UUID,
  confidence NUMERIC DEFAULT 0,
  visual_evidence TEXT,
  distinctive_elements TEXT[] DEFAULT '{}'::text[],
  raw_response JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_detection_log_vod ON public.agent_detection_log(vod_id, outcome);
CREATE INDEX idx_agent_detection_log_run ON public.agent_detection_log(run_id);
CREATE INDEX idx_agent_detection_log_created ON public.agent_detection_log(created_at DESC);

ALTER TABLE public.agent_detection_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read agent_detection_log"
  ON public.agent_detection_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage agent_detection_log"
  ON public.agent_detection_log FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));