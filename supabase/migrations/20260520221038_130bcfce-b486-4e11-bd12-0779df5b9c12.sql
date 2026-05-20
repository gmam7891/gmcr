
-- 1) rejected_detections table
CREATE TABLE IF NOT EXISTS public.rejected_detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vod_id text NOT NULL,
  audit_id uuid,
  streamer_login text,
  timestamp_seconds integer,
  proposed_game text,
  proposed_provider text,
  confidence numeric DEFAULT 0,
  reason text NOT NULL,
  evidence text,
  raw_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rejected_detections_vod ON public.rejected_detections (vod_id);
CREATE INDEX IF NOT EXISTS idx_rejected_detections_audit ON public.rejected_detections (audit_id);

ALTER TABLE public.rejected_detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage rejected_detections"
  ON public.rejected_detections
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can read rejected_detections"
  ON public.rejected_detections
  FOR SELECT
  TO authenticated
  USING (true);

-- 2) Dedup stream_snapshots (storyboard) keeping highest confidence row
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY vod_id, source, timestamp_seconds, COALESCE(game_detected, '')
           ORDER BY COALESCE(ai_confidence, confidence_score, 0) DESC, captured_at ASC, id ASC
         ) AS rn
    FROM public.stream_snapshots
   WHERE source = 'storyboard'
)
DELETE FROM public.stream_snapshots ss
 USING ranked r
 WHERE ss.id = r.id AND r.rn > 1;

-- 3) Dedup raw_evidences keeping highest confidence row
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY vod_id, timestamp_seconds
           ORDER BY confidence_score DESC, created_at ASC, id ASC
         ) AS rn
    FROM public.raw_evidences
   WHERE vod_id IS NOT NULL AND timestamp_seconds IS NOT NULL
)
DELETE FROM public.raw_evidences re
 USING ranked r
 WHERE re.id = r.id AND r.rn > 1;

-- 4) Unique partial index for storyboard snapshots
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stream_snapshots_storyboard
  ON public.stream_snapshots (vod_id, timestamp_seconds, COALESCE(game_detected, ''))
  WHERE source = 'storyboard';

-- 5) Unique index for raw_evidences (vod_id, timestamp_seconds)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_raw_evidences_vod_ts
  ON public.raw_evidences (vod_id, timestamp_seconds)
  WHERE vod_id IS NOT NULL AND timestamp_seconds IS NOT NULL;

-- 6) vod_audits.partial_reason
ALTER TABLE public.vod_audits
  ADD COLUMN IF NOT EXISTS partial_reason text;
