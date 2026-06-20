
-- Campaigns
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  name TEXT NOT NULL,
  budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  target_games TEXT[] NOT NULL DEFAULT '{}',
  target_providers TEXT[] NOT NULL DEFAULT '{}',
  region TEXT,
  objective TEXT,
  notes TEXT,
  results JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read campaigns" ON public.campaigns
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Org members write campaigns" ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id, auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Org members update campaigns" ON public.campaigns
  FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id, auth.uid()))
  WITH CHECK (public.is_org_member(org_id, auth.uid()));

CREATE POLICY "Org members delete campaigns" ON public.campaigns
  FOR DELETE TO authenticated
  USING (public.is_org_member(org_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Pricing tiers
CREATE TABLE public.pricing_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier TEXT NOT NULL UNIQUE,
  min_followers BIGINT NOT NULL DEFAULT 0,
  max_followers BIGINT,
  min_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pricing_tiers TO authenticated;
GRANT ALL ON public.pricing_tiers TO service_role;

ALTER TABLE public.pricing_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read pricing_tiers" ON public.pricing_tiers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage pricing_tiers" ON public.pricing_tiers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER pricing_tiers_updated_at BEFORE UPDATE ON public.pricing_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default tiers
INSERT INTO public.pricing_tiers (tier, min_followers, max_followers, min_cost, max_cost, sort_order) VALUES
  ('Nano',  1000,    10000,    200,    1500,   1),
  ('Micro', 10000,   100000,   1500,   8000,   2),
  ('Mid',   100000,  500000,   8000,   30000,  3),
  ('Macro', 500000,  NULL,     30000,  150000, 4);
