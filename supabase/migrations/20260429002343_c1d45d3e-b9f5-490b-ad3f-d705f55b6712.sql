ALTER TABLE public.raw_evidences
ADD COLUMN IF NOT EXISTS screen_state TEXT
CHECK (screen_state IN ('lobby', 'loading', 'gameplay', 'other'));

CREATE INDEX IF NOT EXISTS idx_raw_evidences_screen_state
ON public.raw_evidences(screen_state);