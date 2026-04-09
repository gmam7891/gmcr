
-- Raw evidences: every individual frame detection
CREATE TABLE public.raw_evidences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vod_id text NOT NULL,
  source_id text,
  streamer_login text NOT NULL,
  platform text NOT NULL DEFAULT 'twitch',
  source_type text NOT NULL DEFAULT 'vod',
  timestamp_seconds integer NOT NULL DEFAULT 0,
  frame_index integer,
  provider_detected text,
  game_detected text,
  provider_id uuid,
  game_id uuid,
  confidence_score numeric NOT NULL DEFAULT 0,
  image_hash text,
  processing_batch_id text,
  is_valid boolean DEFAULT true,
  validation_status text DEFAULT 'pending',
  discard_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_raw_evidences_vod ON public.raw_evidences(vod_id);
CREATE INDEX idx_raw_evidences_streamer ON public.raw_evidences(streamer_login);
CREATE INDEX idx_raw_evidences_batch ON public.raw_evidences(processing_batch_id);

ALTER TABLE public.raw_evidences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read raw_evidences" ON public.raw_evidences
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service can insert raw_evidences" ON public.raw_evidences
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Service can update raw_evidences" ON public.raw_evidences
  FOR UPDATE TO authenticated USING (true);

-- Gameplay blocks: consolidated validated blocks
CREATE TABLE public.gameplay_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vod_id text NOT NULL,
  source_id text,
  streamer_login text NOT NULL,
  platform text NOT NULL DEFAULT 'twitch',
  source_type text NOT NULL DEFAULT 'vod',
  provider_id uuid,
  game_id uuid,
  provider_name text,
  game_name text,
  start_seconds integer NOT NULL,
  end_seconds integer NOT NULL,
  duration_seconds integer NOT NULL,
  evidence_count integer NOT NULL DEFAULT 0,
  confidence_avg numeric NOT NULL DEFAULT 0,
  confidence_min numeric DEFAULT 0,
  confidence_max numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'confirmed',
  discard_reason text,
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  processing_version text DEFAULT 'v1',
  model_version text DEFAULT 'v1',
  rules_version text DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_gameplay_blocks_vod ON public.gameplay_blocks(vod_id);
CREATE INDEX idx_gameplay_blocks_status ON public.gameplay_blocks(status);
CREATE INDEX idx_gameplay_blocks_streamer ON public.gameplay_blocks(streamer_login);

ALTER TABLE public.gameplay_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read gameplay_blocks" ON public.gameplay_blocks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service can manage gameplay_blocks" ON public.gameplay_blocks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Pipeline configuration: tunable thresholds
CREATE TABLE public.pipeline_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text NOT NULL UNIQUE,
  config_value numeric NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.pipeline_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pipeline_configs" ON public.pipeline_configs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage pipeline_configs" ON public.pipeline_configs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Audit logs
CREATE TABLE public.pipeline_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  vod_id text,
  details jsonb DEFAULT '{}',
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_vod ON public.pipeline_audit_logs(vod_id);
CREATE INDEX idx_audit_logs_action ON public.pipeline_audit_logs(action);

ALTER TABLE public.pipeline_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read audit_logs" ON public.pipeline_audit_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service can insert audit_logs" ON public.pipeline_audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- Add versioning columns to vod_audits
ALTER TABLE public.vod_audits
  ADD COLUMN IF NOT EXISTS processing_version text DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS model_version text DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS rules_version text DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS data_quality_status text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS total_evidences integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valid_evidences integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discarded_evidences integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_blocks integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suspect_blocks integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discarded_blocks integer DEFAULT 0;

-- Add block_status to exposure_blocks for filtering
ALTER TABLE public.exposure_blocks
  ADD COLUMN IF NOT EXISTS block_status text DEFAULT 'confirmed';

-- Seed default pipeline configs
INSERT INTO public.pipeline_configs (config_key, config_value, description) VALUES
  ('min_confidence_score', 50, 'Minimum confidence score to consider a detection valid (0-100)'),
  ('min_consecutive_hits', 3, 'Minimum number of consecutive frame detections to form a block'),
  ('min_valid_duration_seconds', 60, 'Minimum duration in seconds for a block to be considered confirmed'),
  ('max_gap_to_merge_blocks', 120, 'Maximum gap in seconds between detections to merge into same block'),
  ('ignore_loading_screens', 1, 'Whether to ignore loading screen detections (1=yes, 0=no)'),
  ('ignore_lobby_screens', 1, 'Whether to ignore lobby screen detections (1=yes, 0=no)'),
  ('ignore_overlay_only_frames', 1, 'Whether to ignore frames with only overlay/webcam (1=yes, 0=no)'),
  ('suspect_confidence_threshold', 70, 'Below this confidence, blocks are marked as suspect instead of confirmed'),
  ('max_coverage_gap_percent', 10, 'Maximum allowed gap percentage before marking VOD as incomplete')
ON CONFLICT (config_key) DO NOTHING;
