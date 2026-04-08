
-- =============================================
-- MODULE 1: Normalized Data Model
-- =============================================

-- Providers (normalized)
CREATE TABLE public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read providers" ON public.providers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage providers" ON public.providers FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Games (normalized)
CREATE TABLE public.games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  category text DEFAULT 'slot',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(slug, provider_id)
);
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read games" ON public.games FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage games" ON public.games FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Alias mapping for normalization
CREATE TABLE public.provider_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias text NOT NULL UNIQUE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE
);
ALTER TABLE public.provider_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read provider_aliases" ON public.provider_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage provider_aliases" ON public.provider_aliases FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.game_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias text NOT NULL UNIQUE,
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE
);
ALTER TABLE public.game_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read game_aliases" ON public.game_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage game_aliases" ON public.game_aliases FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =============================================
-- MODULE 2: Detections & VOD Audit
-- =============================================

-- Detections (unified live + VOD)
CREATE TABLE public.detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_login text NOT NULL,
  platform text NOT NULL DEFAULT 'twitch',
  source_type text NOT NULL CHECK (source_type IN ('live', 'vod')),
  source_id text, -- vod_id or stream_id
  provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  game_id uuid REFERENCES public.games(id) ON DELETE SET NULL,
  provider_name text,
  game_name text,
  confidence numeric(5,2) DEFAULT 0,
  detected_at timestamptz NOT NULL DEFAULT now(),
  exposure_seconds integer DEFAULT 0,
  viewer_count integer DEFAULT 0,
  offset_seconds integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.detections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read detections" ON public.detections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can insert detections" ON public.detections FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_detections_streamer ON public.detections(streamer_login, detected_at);
CREATE INDEX idx_detections_provider ON public.detections(provider_id, detected_at);
CREATE INDEX idx_detections_game ON public.detections(game_id, detected_at);
CREATE INDEX idx_detections_source ON public.detections(source_type, source_id);

-- VOD Audits
CREATE TYPE public.vod_status AS ENUM ('queued', 'processing', 'partial', 'completed', 'failed', 'needs_review', 'reprocessed');

CREATE TABLE public.vod_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vod_id text NOT NULL,
  streamer_login text NOT NULL,
  platform text NOT NULL DEFAULT 'twitch',
  status public.vod_status NOT NULL DEFAULT 'queued',
  vod_duration_seconds integer DEFAULT 0,
  processed_duration_seconds integer DEFAULT 0,
  coverage_percent numeric(5,2) DEFAULT 0,
  expected_frames integer DEFAULT 0,
  processed_frames integer DEFAULT 0,
  failed_frames integer DEFAULT 0,
  gap_seconds integer DEFAULT 0,
  confidence_score numeric(5,2) DEFAULT 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vod_id, platform)
);
ALTER TABLE public.vod_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read vod_audits" ON public.vod_audits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can manage vod_audits" ON public.vod_audits FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_vod_audits_streamer ON public.vod_audits(streamer_login);
CREATE INDEX idx_vod_audits_status ON public.vod_audits(status);

-- =============================================
-- MODULE 3: Processing Queue
-- =============================================

CREATE TYPE public.job_type AS ENUM ('live_capture', 'vod_process', 'chat_ingest', 'reconciliation', 'reprocess');
CREATE TYPE public.job_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE public.job_priority AS ENUM ('critical', 'high', 'normal', 'low');

CREATE TABLE public.processing_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type public.job_type NOT NULL,
  priority public.job_priority NOT NULL DEFAULT 'normal',
  status public.job_status NOT NULL DEFAULT 'pending',
  streamer_login text NOT NULL,
  platform text NOT NULL DEFAULT 'twitch',
  source_id text,
  metadata jsonb DEFAULT '{}',
  attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 3,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.processing_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read processing_queue" ON public.processing_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can manage processing_queue" ON public.processing_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_queue_status_priority ON public.processing_queue(status, priority, created_at);
CREATE INDEX idx_queue_streamer ON public.processing_queue(streamer_login);

-- =============================================
-- MODULE 5: Chat Sentiment
-- =============================================

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_login text NOT NULL,
  platform text NOT NULL DEFAULT 'twitch',
  source_type text NOT NULL DEFAULT 'live',
  source_id text,
  username text NOT NULL,
  message text NOT NULL,
  sentiment_label text CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  intent_label text CHECK (intent_label IN ('hype', 'complaint', 'doubt', 'reaction_game', 'reaction_provider', 'other')),
  is_spam boolean DEFAULT false,
  is_bot boolean DEFAULT false,
  message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read chat_messages" ON public.chat_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can insert chat_messages" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_chat_streamer ON public.chat_messages(streamer_login, message_at);
CREATE INDEX idx_chat_sentiment ON public.chat_messages(sentiment_label, message_at);
CREATE INDEX idx_chat_intent ON public.chat_messages(intent_label, message_at);

-- =============================================
-- MODULE 7: SaaS Plans (evolve access_packages)
-- =============================================

-- Add plan tier and limits to access_packages
ALTER TABLE public.access_packages 
  ADD COLUMN IF NOT EXISTS tier text DEFAULT 'starter' CHECK (tier IN ('starter', 'pro', 'enterprise')),
  ADD COLUMN IF NOT EXISTS max_streamers integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS max_vods_month integer DEFAULT 10,
  ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS description text;

-- Add usage tracking to user_access
ALTER TABLE public.user_access
  ADD COLUMN IF NOT EXISTS vods_used_month integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streamers_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reset_at timestamptz DEFAULT now();

-- Exposure blocks (reconciled continuous exposure)
CREATE TABLE public.exposure_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_login text NOT NULL,
  platform text NOT NULL DEFAULT 'twitch',
  source_type text NOT NULL,
  source_id text,
  provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  game_id uuid REFERENCES public.games(id) ON DELETE SET NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  duration_seconds integer NOT NULL,
  avg_viewers integer DEFAULT 0,
  peak_viewers integer DEFAULT 0,
  viewer_minutes integer DEFAULT 0,
  confidence_avg numeric(5,2) DEFAULT 0,
  is_reconciled boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exposure_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read exposure_blocks" ON public.exposure_blocks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can manage exposure_blocks" ON public.exposure_blocks FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_exposure_streamer ON public.exposure_blocks(streamer_login, start_at);
CREATE INDEX idx_exposure_provider ON public.exposure_blocks(provider_id, start_at);
CREATE INDEX idx_exposure_game ON public.exposure_blocks(game_id, start_at);

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.processing_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.detections;
