
-- 1. Estender game_visual_library com campos do agente
ALTER TABLE public.game_visual_library
  ADD COLUMN IF NOT EXISTS agent_keywords TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS agent_visual_markers TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS agent_confidence_threshold NUMERIC DEFAULT 0.70,
  ADD COLUMN IF NOT EXISTS agent_times_identified INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_times_corrected INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_average_confidence NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_last_identified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_learned_at TIMESTAMPTZ;

-- 2. Tabela de análises do agente
CREATE TABLE IF NOT EXISTS public.agent_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vod_id TEXT NOT NULL,
  streamer_login TEXT NOT NULL,
  game_library_id UUID REFERENCES public.game_visual_library(id) ON DELETE SET NULL,
  game_name TEXT NOT NULL,
  provider_name TEXT,
  start_seconds INTEGER NOT NULL DEFAULT 0,
  end_seconds INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  confidence NUMERIC NOT NULL DEFAULT 0,
  keyword_confidence NUMERIC NOT NULL DEFAULT 0,
  visual_confidence NUMERIC NOT NULL DEFAULT 0,
  agrees_with_pipeline BOOLEAN DEFAULT NULL,
  user_confirmed BOOLEAN DEFAULT FALSE,
  user_corrected BOOLEAN DEFAULT FALSE,
  feedback_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_analyses_vod ON public.agent_analyses(vod_id);
CREATE INDEX IF NOT EXISTS idx_agent_analyses_game ON public.agent_analyses(game_library_id);
CREATE INDEX IF NOT EXISTS idx_agent_analyses_created ON public.agent_analyses(created_at DESC);

ALTER TABLE public.agent_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read agent_analyses"
  ON public.agent_analyses FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage agent_analyses"
  ON public.agent_analyses FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. Tabela de feedback
CREATE TABLE IF NOT EXISTS public.agent_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES public.agent_analyses(id) ON DELETE CASCADE,
  original_game_id UUID REFERENCES public.game_visual_library(id) ON DELETE SET NULL,
  corrected_game_id UUID REFERENCES public.game_visual_library(id) ON DELETE SET NULL,
  correction_type TEXT NOT NULL CHECK (correction_type IN ('confirmed','wrong_game','wrong_provider','false_positive')),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_feedback_analysis ON public.agent_feedback(analysis_id);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_created ON public.agent_feedback(created_at DESC);

ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read agent_feedback"
  ON public.agent_feedback FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage agent_feedback"
  ON public.agent_feedback FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4. Trigger: atualizar estatísticas + threshold ao receber feedback
CREATE OR REPLACE FUNCTION public.handle_agent_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_corrected_count INTEGER;
  v_current_threshold NUMERIC;
BEGIN
  -- Marcar a análise
  IF NEW.correction_type = 'confirmed' THEN
    UPDATE public.agent_analyses
       SET user_confirmed = TRUE, feedback_at = NEW.created_at
     WHERE id = NEW.analysis_id;
  ELSE
    UPDATE public.agent_analyses
       SET user_corrected = TRUE, feedback_at = NEW.created_at
     WHERE id = NEW.analysis_id;

    -- Incrementar contador de correções no jogo errado
    IF NEW.original_game_id IS NOT NULL THEN
      UPDATE public.game_visual_library
         SET agent_times_corrected = agent_times_corrected + 1,
             updated_at = now()
       WHERE id = NEW.original_game_id
       RETURNING agent_times_corrected, agent_confidence_threshold
              INTO v_corrected_count, v_current_threshold;

      -- A cada 5 correções, sobe threshold em 0.02 (até 0.95)
      IF v_corrected_count % 5 = 0 AND v_current_threshold < 0.95 THEN
        UPDATE public.game_visual_library
           SET agent_confidence_threshold = LEAST(0.95, v_current_threshold + 0.02)
         WHERE id = NEW.original_game_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_feedback ON public.agent_feedback;
CREATE TRIGGER trg_agent_feedback
  AFTER INSERT ON public.agent_feedback
  FOR EACH ROW EXECUTE FUNCTION public.handle_agent_feedback();
