
CREATE TABLE public.discovery_prospects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_id uuid NOT NULL DEFAULT gen_random_uuid(),
  platform text NOT NULL DEFAULT 'twitch',
  username text NOT NULL,
  display_name text,
  bio text,
  avatar_url text,
  profile_url text,
  followers integer DEFAULT 0,
  avg_views integer DEFAULT 0,
  posts_last_30d integer DEFAULT 0,
  lives_last_30d integer DEFAULT 0,
  location_declared text,
  location_inferred text,
  has_casino_content boolean DEFAULT false,
  match_score numeric DEFAULT 0,
  score_breakdown jsonb DEFAULT '{}'::jsonb,
  follower_following_ratio numeric DEFAULT 0,
  is_spam boolean DEFAULT false,
  briefing_text text,
  search_keywords text[],
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.discovery_prospects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage discovery_prospects"
ON public.discovery_prospects FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can read discovery_prospects"
ON public.discovery_prospects FOR SELECT
TO authenticated
USING (true);

CREATE INDEX idx_discovery_briefing ON public.discovery_prospects(briefing_id);
CREATE INDEX idx_discovery_score ON public.discovery_prospects(match_score DESC);
