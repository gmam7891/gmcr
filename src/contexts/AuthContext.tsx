import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface UserAccess {
  allowed_tabs: string[];
  expires_at: string | null;
  is_active: boolean;
  package_name: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  userAccess: UserAccess | null;
  loading: boolean;
  orgs: Organization[];
  currentOrg: Organization | null;
  switchOrg: (orgId: string) => Promise<void>;
  refreshOrgs: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshAccess: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userAccess, setUserAccess] = useState<UserAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);

  const fetchOrgs = useCallback(async (userId: string) => {
    const { data: memberships } = await supabase
      .from("organization_members")
      .select("role, org_id, organizations!inner(id, name, slug)")
      .eq("user_id", userId);

    const list: Organization[] = (memberships || []).map((m: any) => ({
      id: m.organizations.id,
      name: m.organizations.name,
      slug: m.organizations.slug,
      role: m.role,
    }));
    setOrgs(list);

    const { data: profile } = await supabase
      .from("profiles")
      .select("current_org_id")
      .eq("id", userId)
      .maybeSingle();

    const activeId = (profile as any)?.current_org_id;
    const active = list.find((o) => o.id === activeId) || list[0] || null;
    setCurrentOrg(active);

    if (active && active.id !== activeId) {
      await supabase.from("profiles").update({ current_org_id: active.id } as any).eq("id", userId);
    }
  }, []);

  const switchOrg = useCallback(async (orgId: string) => {
    if (!user) return;
    const target = orgs.find((o) => o.id === orgId);
    if (!target) return;
    setCurrentOrg(target);
    await supabase.from("profiles").update({ current_org_id: orgId } as any).eq("id", user.id);
  }, [user, orgs]);

  const refreshOrgs = useCallback(async () => {
    if (user) await fetchOrgs(user.id);
  }, [user, fetchOrgs]);

  const fetchAccess = async (userId: string) => {
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    setIsAdmin(!!roleData);

    if (roleData) {
      setUserAccess({
        allowed_tabs: [
          "simulator", "monitor", "authenticity", "instagram", "twitch",
          "youtube", "kick", "tiktok", "icp", "vod", "discovery", "scanner",
          "scanner_dashboard", "scanner_streamers", "scanner_games",
          "scanner_providers", "scanner_chat", "scanner_vod_quality",
          "scanner_queue", "scanner_audit", "scanner_review",
          "scanner_quality", "scanner_ai_lab", "scanner_results",
          "analyst", "planner",
        ],
        expires_at: null,
        is_active: true,
        package_name: "Admin",
      });
      return;
    }

    const { data: accessData } = await supabase
      .from("user_access")
      .select("*, access_packages(name, allowed_tabs)")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (accessData) {
      const isExpired = accessData.expires_at && new Date(accessData.expires_at) < new Date();
      const pkg = accessData.access_packages as any;
      const tabs = accessData.custom_tabs || (pkg?.allowed_tabs) || [];

      setUserAccess({
        allowed_tabs: isExpired ? [] : tabs,
        expires_at: accessData.expires_at,
        is_active: !isExpired && accessData.is_active,
        package_name: pkg?.name || "Personalizado",
      });
    } else {
      setUserAccess({
        allowed_tabs: [],
        expires_at: null,
        is_active: false,
        package_name: null,
      });
    }
  };

  const refreshAccess = async () => {
    if (user) await fetchAccess(user.id);
  };

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          Promise.all([fetchAccess(session.user.id), fetchOrgs(session.user.id)])
            .catch((e) => console.error("auth fetch error:", e))
            .finally(() => { if (mounted) setLoading(false); });
        } else {
          setIsAdmin(false);
          setUserAccess(null);
          setOrgs([]);
          setCurrentOrg(null);
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchOrgs]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
    setUserAccess(null);
    setOrgs([]);
    setCurrentOrg(null);
  };

  return (
    <AuthContext.Provider value={{
      user, session, isAdmin, userAccess, loading,
      orgs, currentOrg, switchOrg, refreshOrgs,
      signIn, signOut, refreshAccess,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
