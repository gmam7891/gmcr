-- 1. Coluna para saldo na tela / HUD de bônus / metadados extras da IA visual
ALTER TABLE public.raw_evidences
ADD COLUMN IF NOT EXISTS extra_metadata jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.raw_evidences.extra_metadata IS
'Dados extras extraídos pela IA visual: saldo_visivel, hud_bonus, free_spins, jackpot_visivel, etc.';

-- 2. View: tempo real por provedora (frames de 15s = 0.25 min cada)
CREATE OR REPLACE VIEW public.provider_real_time
WITH (security_invoker = true)
AS
SELECT
  COALESCE(provider_detected, 'Unknown') AS provider_name,
  COUNT(*) AS frame_count,
  COUNT(*) * 15 AS total_seconds,
  ROUND((COUNT(*) * 15.0 / 60.0)::numeric, 2) AS total_minutes,
  ROUND((COUNT(*) * 15.0 / 3600.0)::numeric, 2) AS total_hours,
  COUNT(DISTINCT vod_id) AS distinct_vods,
  COUNT(DISTINCT streamer_login) AS distinct_streamers,
  AVG(confidence_score)::numeric(5,3) AS avg_confidence,
  MAX(created_at) AS last_detected_at
FROM public.raw_evidences
WHERE is_valid = true
  AND provider_detected IS NOT NULL
  AND provider_detected <> ''
GROUP BY COALESCE(provider_detected, 'Unknown')
ORDER BY total_seconds DESC;

COMMENT ON VIEW public.provider_real_time IS
'Tempo real de exposição por provedora (cada frame = 15s = 0.25 min). Usa security_invoker para herdar RLS de raw_evidences.';