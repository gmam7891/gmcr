-- Remove duplicatas existentes mantendo a evidência de maior confiança por (vod_id, timestamp_seconds)
DELETE FROM public.raw_evidences a
USING public.raw_evidences b
WHERE a.vod_id = b.vod_id
  AND a.timestamp_seconds = b.timestamp_seconds
  AND (
    COALESCE(a.confidence_score, 0) < COALESCE(b.confidence_score, 0)
    OR (COALESCE(a.confidence_score, 0) = COALESCE(b.confidence_score, 0) AND a.id < b.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_raw_evidences_vod_ts
  ON public.raw_evidences (vod_id, timestamp_seconds);