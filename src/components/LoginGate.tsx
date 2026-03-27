import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Loader2 } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

interface LoginGateProps {
  children: React.ReactNode;
}

export function LoginGate({ children }: LoginGateProps) {
  const { user, loading, signIn } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    if (!email || !pass) return;
    setSubmitting(true);
    const { error } = await signIn(email, pass);
    if (error) {
      toast.error(t("login.invalid"));
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 p-6 rounded-xl border border-border bg-card shadow-lg">
        <h1 className="text-lg font-semibold text-center text-foreground">{t("login.title")}</h1>
        <p className="text-xs text-center text-muted-foreground font-mono uppercase tracking-wider">{t("login.subtitle")}</p>
        <Input
          placeholder={t("login.email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        />
        <Input
          type="password"
          placeholder={t("login.password")}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        />
        <Button onClick={handleLogin} className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("login.submit")}
        </Button>
      </div>
    </div>
  );
}
