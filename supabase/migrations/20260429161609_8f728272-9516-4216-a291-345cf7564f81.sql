ALTER TABLE public.raw_evidences
ADD COLUMN IF NOT EXISTS casino_brand TEXT;

CREATE INDEX IF NOT EXISTS idx_raw_evidences_casino_brand
ON public.raw_evidences(casino_brand) WHERE casino_brand IS NOT NULL;