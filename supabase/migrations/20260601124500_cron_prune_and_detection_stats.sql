-- ─────────────────────────────────────────────────────────────────────
-- 1. Cron: poda diária do agent_detection_log (retém 90 dias).
--    prune_agent_detection_log é SQL puro (sem chamada a edge/secret),
--    então pode ser agendado direto via pg_cron — sem URL/anon key.
-- ─────────────────────────────────────────────────────────────────────

-- Idempotente: remove o job anterior (se existir) antes de reagendar.
SELECT cron.unschedule('prune-agent-detection-log')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-agent-detection-log');

SELECT cron.schedule(
  'prune-agent-detection-log',
  '30 3 * * *',                              -- todo dia 03:30 UTC
  $$ SELECT public.prune_agent_detection_log(90); $$
);

-- ─────────────────────────────────────────────────────────────────────
-- 2. agent_detection_stats(run_id): breakdown por outcome + taxas
--    derivadas (override do pHash sobre o Gemini, cobertura do fast-path,
--    alucinação). p_run_id NULL = agrega todos os runs.
--    Usado pela aba do Agente e direto no SQL editor.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.agent_detection_stats(p_run_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT outcome
      FROM public.agent_detection_log
     WHERE p_run_id IS NULL OR run_id = p_run_id
  ),
  c AS (
    SELECT
      count(*)                                              AS total,
      count(*) FILTER (WHERE outcome = 'non_gameplay')      AS non_gameplay,
      count(*) FILTER (WHERE outcome = 'no_game')           AS no_game,
      count(*) FILTER (WHERE outcome = 'hallucinated')      AS hallucinated,
      count(*) FILTER (WHERE outcome = 'low_confidence')    AS low_confidence,
      count(*) FILTER (WHERE outcome = 'review_skipped')    AS review_skipped,
      count(*) FILTER (WHERE outcome = 'promoted')          AS promoted,
      count(*) FILTER (WHERE outcome = 'promoted_by_phash') AS promoted_by_phash,
      count(*) FILTER (WHERE outcome = 'phash_override')    AS phash_override
    FROM base
  )
  SELECT to_jsonb(c) || jsonb_build_object(
    'phash_fired',       c.promoted_by_phash + c.phash_override,
    'total_detections',  c.promoted_by_phash + c.phash_override + c.promoted,
    'gameplay_tiles',    c.total - c.non_gameplay,
    'gemini_named',      c.promoted + c.review_skipped + c.low_confidence
                           + c.hallucinated + c.phash_override,
    -- Quando o pHash dispara, com que frequência discorda do nome do Gemini.
    'override_rate', CASE WHEN (c.promoted_by_phash + c.phash_override) > 0
      THEN round(c.phash_override::numeric / (c.promoted_by_phash + c.phash_override), 4)
      ELSE 0 END,
    -- Das detecções finais, fração resolvida pelo caminho determinístico.
    'phash_detection_share', CASE WHEN (c.promoted_by_phash + c.phash_override + c.promoted) > 0
      THEN round((c.promoted_by_phash + c.phash_override)::numeric
                 / (c.promoted_by_phash + c.phash_override + c.promoted), 4)
      ELSE 0 END,
    -- Dos tiles em que o Gemini nomeou algo, fração fora da biblioteca.
    'hallucination_rate', CASE WHEN (c.promoted + c.review_skipped + c.low_confidence
                                     + c.hallucinated + c.phash_override) > 0
      THEN round(c.hallucinated::numeric
                 / (c.promoted + c.review_skipped + c.low_confidence
                    + c.hallucinated + c.phash_override), 4)
      ELSE 0 END
  )
  FROM c;
$$;

GRANT EXECUTE ON FUNCTION public.agent_detection_stats(uuid) TO authenticated, service_role;

-- Index pra manter a agregação por run barata conforme o log cresce.
CREATE INDEX IF NOT EXISTS idx_agent_detection_log_run_outcome
  ON public.agent_detection_log (run_id, outcome);
