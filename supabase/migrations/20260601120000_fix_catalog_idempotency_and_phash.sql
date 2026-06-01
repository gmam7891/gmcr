-- ─────────────────────────────────────────────────────────────────────
-- 1. casino_catalog_thumbnails: provider_name NULL was breaking the
--    UNIQUE (casino_slug, game_name_normalized, provider_name) constraint
--    because PG treats NULL != NULL in unique indexes. Re-scrapes were
--    silently inserting duplicate rows for every tile whose provider was
--    not auto-detected (most of them).
-- ─────────────────────────────────────────────────────────────────────

UPDATE public.casino_catalog_thumbnails
   SET provider_name = ''
 WHERE provider_name IS NULL;

ALTER TABLE public.casino_catalog_thumbnails
  ALTER COLUMN provider_name SET DEFAULT '',
  ALTER COLUMN provider_name SET NOT NULL;

-- Drop duplicates kept by the previous NULL-leak before they accumulate
-- further. Keep the most-recently-updated row per (slug, normalized, provider).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY casino_slug, game_name_normalized, provider_name
           ORDER BY (status = 'matched') DESC,
                    (status = 'new_pending_dna') DESC,
                    updated_at DESC,
                    id ASC
         ) AS rn
    FROM public.casino_catalog_thumbnails
)
DELETE FROM public.casino_catalog_thumbnails t
 USING ranked r
 WHERE t.id = r.id
   AND r.rn > 1;

-- ─────────────────────────────────────────────────────────────────────
-- 2. phash_hamming: replace the string-conversion popcount with real
--    bitwise arithmetic. Same answer, ~10x faster — and required if we
--    ever call this from the hot path (per-tile during VOD analysis).
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.phash_hamming(a bytea, b bytea)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  i int;
  n int;
  dist int := 0;
  v int;
BEGIN
  IF a IS NULL OR b IS NULL THEN
    RETURN 64;
  END IF;
  n := LEAST(octet_length(a), octet_length(b));
  IF n = 0 THEN
    RETURN 64;
  END IF;
  FOR i IN 0..n-1 LOOP
    v := get_byte(a, i) # get_byte(b, i);
    -- 8-bit popcount via SWAR
    v := (v & 85)  + ((v >> 1) & 85);   -- 0x55
    v := (v & 51)  + ((v >> 2) & 51);   -- 0x33
    v := (v & 15)  + ((v >> 4) & 15);   -- 0x0F
    dist := dist + v;
  END LOOP;
  -- Penalize size mismatches (caller passed truncated bytea)
  dist := dist + (ABS(octet_length(a) - octet_length(b)) * 8);
  RETURN dist;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. find_game_by_phash: previous version had ORDER BY inside the UNION
--    branches with no effect, and returned up to 5 rows mixing library
--    and catalog without a stable tie-breaker. Single ORDER BY at the
--    outermost level, library wins ties (it's the canonical source).
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.find_game_by_phash(
  query_phash bytea,
  max_distance integer DEFAULT 10
)
RETURNS TABLE (
  game_library_id uuid,
  game_name text,
  provider_name text,
  distance integer,
  source text,
  casino_slug text
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH lib AS (
    SELECT
      gvl.id AS game_library_id,
      gvl.game_name,
      gvl.provider_name,
      public.phash_hamming(gvl.thumbnail_phash, query_phash) AS distance,
      'library'::text AS source,
      NULL::text AS casino_slug
    FROM public.game_visual_library gvl
    WHERE gvl.thumbnail_phash IS NOT NULL
  ),
  cat AS (
    SELECT
      cct.game_library_id,
      cct.game_name_raw AS game_name,
      cct.provider_name,
      public.phash_hamming(cct.phash, query_phash) AS distance,
      'catalog'::text AS source,
      cct.casino_slug
    FROM public.casino_catalog_thumbnails cct
    WHERE cct.phash IS NOT NULL
      AND cct.game_library_id IS NOT NULL
  ),
  combined AS (
    SELECT * FROM lib
    UNION ALL
    SELECT * FROM cat
  )
  SELECT * FROM combined
   WHERE distance <= max_distance
   ORDER BY distance ASC, (source = 'library') DESC
   LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.phash_hamming(bytea, bytea) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_game_by_phash(bytea, integer) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 4. agent_detection_log retention (best-effort, called from a cron job
--    or manually). Default keeps 90 days — enough for audit, won't
--    explode storage.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prune_agent_detection_log(retain_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted int;
BEGIN
  DELETE FROM public.agent_detection_log
   WHERE created_at < NOW() - (retain_days || ' days')::interval;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_agent_detection_log(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_agent_detection_log(integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 5. pipeline_configs seed: tornar configurável o GAP do Modo Solo e os
--    knobs do fast-path por pHash, sem precisar redeployar a edge.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO public.pipeline_configs (config_key, config_value, description) VALUES
  ('solo_block_gap_seconds', 60,
    'Quantos segundos sem detectar o mesmo jogo antes de fechar a sessão no Modo Solo.'),
  ('solo_phash_max_distance', 10,
    'Distância de Hamming máxima entre o pHash do tile e o da biblioteca para match determinístico.'),
  ('solo_phash_enabled', 1,
    'Liga o fast-path por pHash no Modo Solo (1=ligado, 0=desligado).')
ON CONFLICT (config_key) DO NOTHING;
