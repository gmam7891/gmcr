import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface UserAccess {
  allowed_tabs: string[];
  expires_at: string | null;
  is_active: boolean;
  package_name: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  userAccess: UserAccess | null;
  loading: boolean;
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

  const fetchAccess = async (userId: string) => {
    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    setIsAdmin(!!roleData);

    if (roleData) {
      // Admin has full access
      setUserAccess({
        allowed_tabs: ["simulator", "monitor", "authenticity", "instagram", "twitch", "youtube", "kick", "icp", "vod", "scanner", "scanner_dashboard", "scanner_streamers", "scanner_games", "scanner_providers", "scanner_chat", "scanner_vod_quality", "scanner_queue"],
        expires_at: null,
        is_active: true,
        package_name: "Admin",
      });
      return;
    }

    // Check user access
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

    // IMPORTANT: Do NOT await inside onAuthStateChange — it causes a deadlock.
    // Use "fire and forget" for side effects.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchAccess(session.user.id)
            .catch((e) => console.error("fetchAccess error:", e))
            .finally(() => { if (mounted) setLoading(false); });
        } else {
          setIsAdmin(false);
          setUserAccess(null);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchAccess(session.user.id)
          .catch((e) => console.error("fetchAccess error:", e))
          .finally(() => { if (mounted) setLoading(false); });
      } else {
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

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
  };

  return (
    <AuthContext.Provider value={{ user, session, isAdmin, userAccess, loading, signIn, signOut, refreshAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
