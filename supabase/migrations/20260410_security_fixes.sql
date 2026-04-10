-- 1. SEGURANÇA DAS TABELAS CORE
ALTER TABLE public.monitored_streamers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_snapshots ENABLE ROW LEVEL SECURITY;

-- Políticas para monitored_streamers
DROP POLICY IF EXISTS "Authenticated users can view their own monitored streamers" ON public.monitored_streamers;
CREATE POLICY "Authenticated users can view their own monitored streamers" ON public.monitored_streamers FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can insert their own monitored streamers" ON public.monitored_streamers;
CREATE POLICY "Authenticated users can insert their own monitored streamers" ON public.monitored_streamers FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Políticas para stream_snapshots (A IA corrige, o usuário apenas vê)
DROP POLICY IF EXISTS "Authenticated users can view snapshots" ON public.stream_snapshots;
CREATE POLICY "Authenticated users can view snapshots" ON public.stream_snapshots FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role can manage snapshots" ON public.stream_snapshots;
CREATE POLICY "Service role can manage snapshots" ON public.stream_snapshots FOR ALL USING (auth.role() = 'service_role');

-- 2. NOVAS COLUNAS PARA A INTELIGÊNCIA ARTIFICIAL
ALTER TABLE public.stream_snapshots 
ADD COLUMN IF NOT EXISTS is_ai_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC;

-- 3. SEGURANÇA DO REALTIME (CANAL DE MENSAGENS)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Restrict sensitive topics" ON realtime.messages;
CREATE POLICY "Restrict sensitive topics" ON realtime.messages FOR SELECT USING (NOT (topic LIKE 'pg:realtime:detections' OR topic LIKE 'pg:realtime:processing_queue'));
