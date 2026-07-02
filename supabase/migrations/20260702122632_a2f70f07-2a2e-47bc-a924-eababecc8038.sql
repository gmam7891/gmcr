ALTER TABLE public.access_packages ADD COLUMN IF NOT EXISTS allowed_stages jsonb;
ALTER TABLE public.user_access ADD COLUMN IF NOT EXISTS allowed_stages jsonb;