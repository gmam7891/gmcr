
-- 1. casino_catalogs: lista de casas a scrapear
CREATE TABLE public.casino_catalogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  casino_slug text NOT NULL UNIQUE,
  casino_name text NOT NULL,
  urls text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  last_scraped_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.casino_catalogs TO authenticated;
GRANT ALL ON public.casino_catalogs TO service_role;
ALTER TABLE public.casino_catalogs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage casino_catalogs"
  ON public.casino_catalogs FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Authenticated read casino_catalogs"
  ON public.casino_catalogs FOR SELECT TO authenticated
  USING (true);

-- 2. casino_catalog_thumbnails: 1 linha por tile extraído
CREATE TABLE public.casino_catalog_thumbnails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  casino_slug text NOT NULL,
  casino_name text,
  game_name_raw text NOT NULL,
  game_name_normalized text NOT NULL,
  provider_name text,
  thumbnail_url text,            -- storage path (game-thumbnails/{slug}/...)
  thumbnail_source_url text,     -- URL original na CDN do cassino
  source_page_url text,
  phash bytea,                   -- 8 bytes / 64 bits
  game_library_id uuid,          -- soft FK -> game_visual_library
  status text NOT NULL DEFAULT 'pending', -- pending | matched | new_pending_dna | failed
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (casino_slug, game_name_normalized, provider_name)
);

CREATE INDEX idx_cct_casino ON public.casino_catalog_thumbnails (casino_slug);
CREATE INDEX idx_cct_library ON public.casino_catalog_thumbnails (game_library_id);
CREATE INDEX idx_cct_status ON public.casino_catalog_thumbnails (status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.casino_catalog_thumbnails TO authenticated;
GRANT ALL ON public.casino_catalog_thumbnails TO service_role;
ALTER TABLE public.casino_catalog_thumbnails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage casino_catalog_thumbnails"
  ON public.casino_catalog_thumbnails FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Authenticated read casino_catalog_thumbnails"
  ON public.casino_catalog_thumbnails FOR SELECT TO authenticated
  USING (true);

-- 3. game_visual_library: campos novos
ALTER TABLE public.game_visual_library
  ADD COLUMN IF NOT EXISTS thumbnail_phash bytea,
  ADD COLUMN IF NOT EXISTS thumbnails jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 4. Storage bucket público pra thumbnails
INSERT INTO storage.buckets (id, name, public)
VALUES ('game-thumbnails', 'game-thumbnails', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read game-thumbnails"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'game-thumbnails');

CREATE POLICY "Admins write game-thumbnails"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'game-thumbnails' AND has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Admins update game-thumbnails"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'game-thumbnails' AND has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Admins delete game-thumbnails"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'game-thumbnails' AND has_role(auth.uid(),'admin'::app_role));

-- 5. Função helper: distância de Hamming entre dois phash bytea
CREATE OR REPLACE FUNCTION public.phash_hamming(a bytea, b bytea)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT SUM(
      length(replace((get_byte(a,i) # get_byte(b,i))::bit(8)::text, '0',''))
    )::int
     FROM generate_series(0, LEAST(octet_length(a), octet_length(b)) - 1) AS i),
    64
  );
$$;

-- 6. RPC: encontra match por pHash (Hamming <= threshold)
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
  )
  SELECT * FROM lib WHERE distance <= max_distance
  UNION ALL
  SELECT * FROM cat WHERE distance <= max_distance
  ORDER BY distance ASC
  LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.phash_hamming(bytea, bytea) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_game_by_phash(bytea, integer) TO authenticated, service_role;
