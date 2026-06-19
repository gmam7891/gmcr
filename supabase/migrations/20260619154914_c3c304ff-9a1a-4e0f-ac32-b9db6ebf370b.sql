
-- ============================================================
-- FASE 1: FUNDAÇÃO MULTI-ORG
-- ============================================================

-- 1) Enum de papéis dentro da org
DO $$ BEGIN
  CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Tabela organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 3) Tabela organization_members
CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_members TO service_role;

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- 4) Helpers SECURITY DEFINER (evitam recursão RLS)
CREATE OR REPLACE FUNCTION public.is_org_member(_org_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE org_id = _org_id AND user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_org_ids(_user_id UUID)
RETURNS TABLE(org_id UUID)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT om.org_id FROM public.organization_members om WHERE om.user_id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.is_org_role(_org_id UUID, _user_id UUID, _role public.org_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE org_id = _org_id AND user_id = _user_id AND role = _role
  );
$$;

-- 5) Policies organizations
DROP POLICY IF EXISTS "Members can view their orgs" ON public.organizations;
CREATE POLICY "Members can view their orgs" ON public.organizations
  FOR SELECT TO authenticated
  USING (public.is_org_member(id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Owners can update their orgs" ON public.organizations;
CREATE POLICY "Owners can update their orgs" ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.is_org_role(id, auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated can create orgs" ON public.organizations;
CREATE POLICY "Authenticated can create orgs" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete orgs" ON public.organizations;
CREATE POLICY "Admins can delete orgs" ON public.organizations
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 6) Policies organization_members
DROP POLICY IF EXISTS "Members can view their memberships" ON public.organization_members;
CREATE POLICY "Members can view their memberships" ON public.organization_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_org_role(org_id, auth.uid(), 'owner')
    OR public.is_org_role(org_id, auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Owners/admins manage memberships" ON public.organization_members;
CREATE POLICY "Owners/admins manage memberships" ON public.organization_members
  FOR ALL TO authenticated
  USING (
    public.is_org_role(org_id, auth.uid(), 'owner')
    OR public.is_org_role(org_id, auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    public.is_org_role(org_id, auth.uid(), 'owner')
    OR public.is_org_role(org_id, auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin')
  );

-- 7) profiles.current_org_id
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS current_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

-- 8) Auto-create owner membership após inserir org
CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.organization_members (org_id, user_id, role)
  VALUES (NEW.id, NEW.owner_user_id, 'owner')
  ON CONFLICT (org_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_new_organization ON public.organizations;
CREATE TRIGGER trg_new_organization
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization();

-- 9) updated_at trigger genérico (se ainda não existir)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON public.organizations;
CREATE TRIGGER trg_organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 10) Adicionar org_id às tabelas alvo (Analista + Planejador)
ALTER TABLE public.vod_audits ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.discovery_prospects ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.monitored_streamers ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vod_audits_org_id ON public.vod_audits(org_id);
CREATE INDEX IF NOT EXISTS idx_discovery_prospects_org_id ON public.discovery_prospects(org_id);
CREATE INDEX IF NOT EXISTS idx_monitored_streamers_org_id ON public.monitored_streamers(org_id);

-- 11) Backfill: criar org "Default" e atribuir dados existentes
DO $$
DECLARE
  v_admin_id UUID;
  v_default_org_id UUID;
  v_user RECORD;
BEGIN
  -- Pega o primeiro admin existente
  SELECT user_id INTO v_admin_id
  FROM public.user_roles WHERE role = 'admin'
  ORDER BY id LIMIT 1;

  -- Fallback: primeiro usuário do auth
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM auth.users ORDER BY created_at LIMIT 1;
  END IF;

  -- Só prossegue se existe pelo menos um usuário
  IF v_admin_id IS NOT NULL THEN
    -- Cria/recupera org Default
    SELECT id INTO v_default_org_id FROM public.organizations WHERE slug = 'default' LIMIT 1;
    IF v_default_org_id IS NULL THEN
      INSERT INTO public.organizations (name, slug, owner_user_id)
      VALUES ('Default', 'default', v_admin_id)
      RETURNING id INTO v_default_org_id;
      -- trigger já cria membership owner
    END IF;

    -- Adiciona todos os outros usuários como member da default
    FOR v_user IN SELECT id FROM auth.users WHERE id != v_admin_id LOOP
      INSERT INTO public.organization_members (org_id, user_id, role)
      VALUES (v_default_org_id, v_user.id, 'member')
      ON CONFLICT (org_id, user_id) DO NOTHING;
    END LOOP;

    -- Set current_org_id para todos os profiles
    UPDATE public.profiles SET current_org_id = v_default_org_id WHERE current_org_id IS NULL;

    -- Backfill dados existentes
    UPDATE public.vod_audits SET org_id = v_default_org_id WHERE org_id IS NULL;
    UPDATE public.discovery_prospects SET org_id = v_default_org_id WHERE org_id IS NULL;
    UPDATE public.monitored_streamers SET org_id = v_default_org_id WHERE org_id IS NULL;
  END IF;
END $$;

-- 12) Policies novas (org-scoped) para as 3 tabelas migradas
-- vod_audits
DROP POLICY IF EXISTS "Org members read vod_audits" ON public.vod_audits;
CREATE POLICY "Org members read vod_audits" ON public.vod_audits
  FOR SELECT TO authenticated
  USING (
    org_id IS NULL  -- legado: ainda visível enquanto migra
    OR public.is_org_member(org_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- discovery_prospects
DROP POLICY IF EXISTS "Org members read discovery_prospects" ON public.discovery_prospects;
CREATE POLICY "Org members read discovery_prospects" ON public.discovery_prospects
  FOR SELECT TO authenticated
  USING (
    org_id IS NULL
    OR public.is_org_member(org_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- monitored_streamers
DROP POLICY IF EXISTS "Org members read monitored_streamers" ON public.monitored_streamers;
CREATE POLICY "Org members read monitored_streamers" ON public.monitored_streamers
  FOR SELECT TO authenticated
  USING (
    org_id IS NULL
    OR public.is_org_member(org_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );
