
ALTER TABLE public.vod_audits
  ADD COLUMN IF NOT EXISTS pending_frames    jsonb  DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS total_frames      integer,
  ADD COLUMN IF NOT EXISTS storyboard_variant text,
  ADD COLUMN IF NOT EXISTS detection_strategy text DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS diagnostics       jsonb  DEFAULT '{}'::jsonb;

-- Atomic claim of next sprite from pending_frames queue.
CREATE OR REPLACE FUNCTION public.claim_next_sprite(_audit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sprite jsonb;
BEGIN
  UPDATE public.vod_audits
     SET pending_frames = pending_frames - 0,
         updated_at = now()
   WHERE id = _audit_id
     AND jsonb_typeof(pending_frames) = 'array'
     AND jsonb_array_length(pending_frames) > 0
   RETURNING pending_frames->-1 || '{}'::jsonb
   INTO v_sprite;
  -- We use "- 0" to pop element 0. The RETURNING clause runs AFTER the update,
  -- so we need to recover the removed element in a second read from the OLD row.
  RETURN v_sprite;
END;
$$;

-- Better version: pop head and return it via CTE.
CREATE OR REPLACE FUNCTION public.claim_next_sprite(_audit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sprite jsonb;
  v_rest   jsonb;
BEGIN
  SELECT pending_frames->0,
         CASE
           WHEN jsonb_array_length(pending_frames) > 1
             THEN pending_frames - 0
           ELSE '[]'::jsonb
         END
    INTO v_sprite, v_rest
    FROM public.vod_audits
   WHERE id = _audit_id
     FOR UPDATE;

  IF v_sprite IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.vod_audits
     SET pending_frames = v_rest,
         updated_at = now()
   WHERE id = _audit_id;

  RETURN v_sprite;
END;
$$;

-- Apply a diagnostics delta and return remaining sprites + progress percent.
CREATE OR REPLACE FUNCTION public.apply_chunk_result(_audit_id uuid, _delta jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current jsonb;
  v_merged  jsonb;
  v_reasons jsonb;
  v_remaining int;
  v_total int;
  v_progress int;
BEGIN
  SELECT COALESCE(diagnostics, '{}'::jsonb), COALESCE(total_frames, 0)
    INTO v_current, v_total
    FROM public.vod_audits
   WHERE id = _audit_id
     FOR UPDATE;

  v_reasons := COALESCE(v_current->'unidentified_reasons', '{}'::jsonb);
  IF _delta ? 'unidentified_reasons' THEN
    SELECT jsonb_object_agg(k, COALESCE((v_reasons->>k)::int, 0) + (v)::int)
      INTO v_reasons
      FROM (
        SELECT k, (v)::text::int AS v
          FROM jsonb_each_text(_delta->'unidentified_reasons')
        UNION ALL
        SELECT k, 0
          FROM jsonb_each_text(v_reasons)
         WHERE NOT (_delta->'unidentified_reasons') ? k
      ) t(k, v);
  END IF;

  v_merged := jsonb_build_object(
    'manifest_variant',     COALESCE(_delta->>'manifest_variant',     v_current->>'manifest_variant'),
    'manifest_sprites',     COALESCE((_delta->>'manifest_sprites')::int, (v_current->>'manifest_sprites')::int, 0),
    'manifest_frames',      COALESCE((_delta->>'manifest_frames')::int,  (v_current->>'manifest_frames')::int,  0),
    'sprites_downloaded',   COALESCE((v_current->>'sprites_downloaded')::int, 0) + COALESCE((_delta->>'sprites_downloaded')::int, 0),
    'sprites_failed',       COALESCE((v_current->>'sprites_failed')::int, 0)     + COALESCE((_delta->>'sprites_failed')::int, 0),
    'frames_detected',      COALESCE((v_current->>'frames_detected')::int, 0)    + COALESCE((_delta->>'frames_detected')::int, 0),
    'frames_unidentified',  COALESCE((v_current->>'frames_unidentified')::int, 0)+ COALESCE((_delta->>'frames_unidentified')::int, 0),
    'frames_other_casino',  COALESCE((v_current->>'frames_other_casino')::int, 0)+ COALESCE((_delta->>'frames_other_casino')::int, 0),
    'frames_low_confidence',COALESCE((v_current->>'frames_low_confidence')::int, 0)+ COALESCE((_delta->>'frames_low_confidence')::int, 0),
    'unidentified_reasons', v_reasons,
    'missing_reference_thumbs',
      COALESCE(v_current->'missing_reference_thumbs', '[]'::jsonb) || COALESCE(_delta->'missing_reference_thumbs', '[]'::jsonb)
  );

  SELECT COALESCE(jsonb_array_length(pending_frames), 0)
    INTO v_remaining
    FROM public.vod_audits
   WHERE id = _audit_id;

  IF v_total > 0 THEN
    v_progress := GREATEST(0, LEAST(100, 100 - (v_remaining * 100 / GREATEST(1, (SELECT COALESCE((v_merged->>'manifest_sprites')::int, v_remaining + 1))))));
  ELSE
    v_progress := 0;
  END IF;

  UPDATE public.vod_audits
     SET diagnostics = v_merged,
         updated_at  = now()
   WHERE id = _audit_id;

  RETURN jsonb_build_object(
    'remaining_sprites', v_remaining,
    'progress',          v_progress,
    'diagnostics',       v_merged
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_sprite(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_chunk_result(uuid, jsonb)      TO authenticated, service_role;
