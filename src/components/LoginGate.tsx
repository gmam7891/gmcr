import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const VALID_USER = "gulhermemontanari";
const VALID_PASS = "Guim1987!";

interface LoginGateProps {
  children: React.ReactNode;
}

export function LoginGate({ children }: LoginGateProps) {
  const [authenticated, setAuthenticated] = useState(
    () => sessionStorage.getItem("auth") === "1"
  );
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  const handleLogin = () => {
    if (user === VALID_USER && pass === VALID_PASS) {
      sessionStorage.setItem("auth", "1");
      setAuthenticated(true);
    } else {
      toast.error("Credenciais inválidas");
    }
  };

  if (authenticated) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 p-6 rounded-xl border border-border bg-card shadow-lg">
        <h1 className="text-lg font-semibold text-center text-foreground">Login</h1>
        <Input
          placeholder="Usuário"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        />
        <Input
          type="password"
          placeholder="Senha"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        />
        <Button onClick={handleLogin} className="w-full">
          Entrar
        </Button>
      </div>
    </div>
  );
}
