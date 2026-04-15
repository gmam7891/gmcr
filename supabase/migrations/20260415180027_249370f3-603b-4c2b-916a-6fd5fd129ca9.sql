
-- Create training status enum
CREATE TYPE public.training_status AS ENUM ('pending', 'processing', 'trained', 'failed');

-- Create game_visual_library table
CREATE TABLE public.game_visual_library (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_name TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_slug TEXT NOT NULL,
  source_url TEXT,
  visual_dna JSONB DEFAULT '{}'::jsonb,
  logo_url TEXT,
  hud_url TEXT,
  paytable_url TEXT,
  training_status public.training_status NOT NULL DEFAULT 'pending',
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_gvl_provider_slug ON public.game_visual_library (provider_slug);
CREATE INDEX idx_gvl_training_status ON public.game_visual_library (training_status);
CREATE UNIQUE INDEX idx_gvl_game_provider ON public.game_visual_library (game_name, provider_slug);

-- Enable RLS
ALTER TABLE public.game_visual_library ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated can read game_visual_library"
ON public.game_visual_library FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can manage game_visual_library"
ON public.game_visual_library FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Create storage bucket for game reference images
INSERT INTO storage.buckets (id, name, public) VALUES ('game-references', 'game-references', true);

-- Storage RLS policies
CREATE POLICY "Authenticated can view game references"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'game-references');

CREATE POLICY "Admins can upload game references"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'game-references' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update game references"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'game-references' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete game references"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'game-references' AND has_role(auth.uid(), 'admin'::app_role));
