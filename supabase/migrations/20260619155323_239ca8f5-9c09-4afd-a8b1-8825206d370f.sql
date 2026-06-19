
-- 1) Tabela reports
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  summary_text TEXT,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, week_start)
);

GRANT SELECT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read reports" ON public.reports;
CREATE POLICY "Org members read reports" ON public.reports
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_reports_org_week ON public.reports(org_id, week_start DESC);

-- 2) Views analyst_v_*
CREATE OR REPLACE VIEW public.analyst_v_vod_audits AS
SELECT
  va.id, va.org_id, va.streamer_login, va.platform, va.vod_id,
  va.vod_duration_seconds, va.processed_duration_seconds, va.coverage_percent,
  va.processed_frames, va.expected_frames, va.failed_frames,
  va.confirmed_blocks, va.suspect_blocks, va.discarded_blocks,
  va.progress_games_found, va.confidence_score, va.status,
  va.created_at, va.updated_at, va.completed_at, va.vod_created_at
FROM public.vod_audits va
WHERE va.org_id IS NOT NULL
  AND va.org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid;

CREATE OR REPLACE VIEW public.analyst_v_discovery_prospects AS
SELECT
  id, org_id, briefing_id, platform, username, display_name, bio,
  followers, avg_views, posts_last_30d, lives_last_30d,
  location_declared, location_inferred, has_casino_content,
  match_score, follower_following_ratio, is_spam,
  briefing_text, search_keywords, created_at
FROM public.discovery_prospects
WHERE org_id IS NOT NULL
  AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid;

CREATE OR REPLACE VIEW public.analyst_v_monitored_streamers AS
SELECT *
FROM public.monitored_streamers
WHERE org_id IS NOT NULL
  AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid;

CREATE OR REPLACE VIEW public.analyst_v_detections AS
SELECT
  id, streamer_login, platform, source_type, source_id,
  provider_id, game_id, provider_name, game_name,
  confidence, detected_at, exposure_seconds, viewer_count,
  offset_seconds, created_at
FROM public.detections;

CREATE OR REPLACE VIEW public.analyst_v_exposure_blocks AS
SELECT
  id, streamer_login, platform, source_type, source_id,
  provider_id, game_id, start_at, end_at, duration_seconds,
  avg_viewers, peak_viewers, viewer_minutes, confidence_avg,
  is_reconciled, block_status, created_at
FROM public.exposure_blocks;

CREATE OR REPLACE VIEW public.analyst_v_gameplay_blocks AS
SELECT
  id, vod_id, streamer_login, platform, source_type,
  provider_id, game_id, provider_name, game_name,
  start_seconds, end_seconds
FROM public.gameplay_blocks;

GRANT SELECT ON public.analyst_v_vod_audits TO authenticated, service_role;
GRANT SELECT ON public.analyst_v_discovery_prospects TO authenticated, service_role;
GRANT SELECT ON public.analyst_v_monitored_streamers TO authenticated, service_role;
GRANT SELECT ON public.analyst_v_detections TO authenticated, service_role;
GRANT SELECT ON public.analyst_v_exposure_blocks TO authenticated, service_role;
GRANT SELECT ON public.analyst_v_gameplay_blocks TO authenticated, service_role;

-- 4) RPC analyst_run_query
CREATE OR REPLACE FUNCTION public.analyst_run_query(_sql TEXT, _org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sql_lower TEXT;
  v_result JSONB;
  v_forbidden TEXT[] := ARRAY[
    'insert ', 'update ', 'delete ', 'drop ', 'alter ', 'truncate ',
    'create ', 'grant ', 'revoke ', 'comment ', 'merge ',
    '--', '/*', 'pg_', 'information_schema'
  ];
  v_word TEXT;
  v_caller UUID;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_org_member(_org_id, v_caller) AND NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'forbidden: not a member of org %', _org_id;
  END IF;

  IF _sql IS NULL OR length(trim(_sql)) = 0 THEN
    RAISE EXCEPTION 'empty query';
  END IF;

  _sql := rtrim(trim(_sql), ';');
  v_sql_lower := lower(_sql);

  IF NOT (v_sql_lower LIKE 'select%' OR v_sql_lower LIKE 'with%') THEN
    RAISE EXCEPTION 'only SELECT/WITH queries allowed';
  END IF;

  IF position(';' IN _sql) > 0 THEN
    RAISE EXCEPTION 'multiple statements not allowed';
  END IF;

  FOREACH v_word IN ARRAY v_forbidden LOOP
    IF position(v_word IN v_sql_lower) > 0 THEN
      RAISE EXCEPTION 'forbidden keyword: %', v_word;
    END IF;
  END LOOP;

  IF v_sql_lower ~ '\m(auth\.|profiles\M|user_roles\M|user_access\M|organizations\M|organization_members\M|vod_audits\M|discovery_prospects\M|monitored_streamers\M|detections\M|exposure_blocks\M|gameplay_blocks\M|reports\M|chat_messages\M|raw_evidences\M)' THEN
    RAISE EXCEPTION 'direct table access not allowed; use analyst_v_* views';
  END IF;

  IF v_sql_lower !~ '\mlimit\M' THEN
    _sql := _sql || ' LIMIT 500';
  END IF;

  PERFORM set_config('app.current_org_id', _org_id::text, true);

  EXECUTE format('SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', _sql) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.analyst_run_query(TEXT, UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.analyst_run_query(TEXT, UUID) TO authenticated, service_role;
