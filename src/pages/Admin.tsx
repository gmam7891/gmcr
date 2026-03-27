import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, UserPlus, Trash2, Shield, ArrowLeft, Key } from "lucide-react";
import { useNavigate } from "react-router-dom";

const ALL_TABS = [
  { id: "simulator", label: "⚡ Simulador" },
  { id: "monitor", label: "📡 Monitor" },
  { id: "instagram", label: "Instagram" },
  { id: "twitch", label: "Twitch" },
  { id: "youtube", label: "YouTube" },
  { id: "kick", label: "Kick" },
  { id: "icp", label: "ICP Calc" },
  { id: "vod", label: "VOD Analyzer" },
];

interface ManagedUser {
  id: string;
  email: string;
  display_name: string | null;
  roles: string[];
  access: any[];
}

interface Package {
  id: string;
  name: string;
  allowed_tabs: string[];
}

export default function Admin() {
  const { isAdmin, session } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);

  // New user form
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // New package form
  const [pkgName, setPkgName] = useState("");
  const [pkgTabs, setPkgTabs] = useState<string[]>([]);
  const [creatingPkg, setCreatingPkg] = useState(false);

  // Access assignment
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [accessMode, setAccessMode] = useState<"package" | "custom">("package");
  const [selectedPkg, setSelectedPkg] = useState<string>("");
  const [customTabs, setCustomTabs] = useState<string[]>([]);
  const [duration, setDuration] = useState<string>("30");
  const [settingAccess, setSettingAccess] = useState(false);

  const invokeAdmin = async (action: string, payload: any = {}) => {
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: { action, ...payload },
    });
    if (error) {
      // Try to extract the actual error message from the response
      const msg = typeof data === 'object' && data?.error ? data.error : error.message;
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await invokeAdmin("list_users");
      setUsers(data.users || []);

      const { data: pkgs } = await supabase
        .from("access_packages")
        .select("*")
        .order("created_at");
      setPackages((pkgs || []) as Package[]);
    } catch (e: any) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) fetchData();
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-destructive font-mono">Acesso restrito a administradores</p>
      </div>
    );
  }

  const handleCreateUser = async () => {
    if (!newEmail || !newPass) return;
    setCreating(true);
    try {
      await invokeAdmin("create_user", {
        email: newEmail,
        password: newPass,
        display_name: newName || newEmail,
      });
      toast.success("Usuário criado!");
      setNewEmail("");
      setNewPass("");
      setNewName("");
      fetchData();
    } catch (e: any) {
      toast.error(e.message);
    }
    setCreating(false);
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Tem certeza que deseja remover este usuário?")) return;
    try {
      await invokeAdmin("delete_user", { user_id: userId });
      toast.success("Usuário removido");
      fetchData();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCreatePackage = async () => {
    if (!pkgName || pkgTabs.length === 0) return;
    setCreatingPkg(true);
    try {
      const { error } = await supabase.from("access_packages").insert({
        name: pkgName,
        allowed_tabs: pkgTabs,
      });
      if (error) throw error;
      toast.success("Pacote criado!");
      setPkgName("");
      setPkgTabs([]);
      fetchData();
    } catch (e: any) {
      toast.error(e.message);
    }
    setCreatingPkg(false);
  };

  const handleSetAccess = async () => {
    if (!selectedUser) return;
    setSettingAccess(true);
    try {
      const payload: any = {
        user_id: selectedUser,
        duration_days: duration === "unlimited" ? null : parseInt(duration),
      };
      if (accessMode === "package" && selectedPkg) {
        payload.package_id = selectedPkg;
      } else if (accessMode === "custom" && customTabs.length > 0) {
        payload.custom_tabs = customTabs;
      }
      await invokeAdmin("set_access", payload);
      toast.success("Acesso configurado!");
      setSelectedUser("");
      setSelectedPkg("");
      setCustomTabs([]);
      fetchData();
    } catch (e: any) {
      toast.error(e.message);
    }
    setSettingAccess(false);
  };

  const toggleTab = (tabId: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(tabId) ? list.filter((t) => t !== tabId) : [...list, tabId]);
  };

  const getUserAccessInfo = (user: ManagedUser) => {
    const activeAccess = user.access?.find((a: any) => a.is_active);
    if (!activeAccess) return { tabs: [], expired: false, label: "Sem acesso" };
    const isExpired = activeAccess.expires_at && new Date(activeAccess.expires_at) < new Date();
    const tabs = activeAccess.custom_tabs || activeAccess.access_packages?.allowed_tabs || [];
    const pkgName = activeAccess.access_packages?.name;
    const expiresLabel = activeAccess.expires_at
      ? `até ${new Date(activeAccess.expires_at).toLocaleDateString("pt-BR")}`
      : "Indeterminado";
    return {
      tabs,
      expired: isExpired,
      label: isExpired ? "Expirado" : `${pkgName || "Personalizado"} • ${expiresLabel}`,
    };
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold text-foreground">Painel Admin</h1>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          Gerenciamento de Acessos
        </span>
      </header>

      <main className="p-6 space-y-8 max-w-5xl mx-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Create User */}
            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <UserPlus className="h-4 w-4" /> Criar Usuário
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input placeholder="Nome" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <Input placeholder="Email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                <Input placeholder="Senha" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
              </div>
              <Button onClick={handleCreateUser} disabled={creating} size="sm">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar Usuário"}
              </Button>
            </Card>

            {/* Packages */}
            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Key className="h-4 w-4" /> Pacotes de Acesso
              </h2>
              {packages.length > 0 && (
                <div className="space-y-2">
                  {packages.map((pkg) => (
                    <div key={pkg.id} className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
                      <Badge variant="outline" className="text-xs">{pkg.name}</Badge>
                      <span>→</span>
                      {pkg.allowed_tabs.map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-3">
                <Input placeholder="Nome do pacote (ex: Básico, Pro, Full)" value={pkgName} onChange={(e) => setPkgName(e.target.value)} />
                <div className="flex flex-wrap gap-3">
                  {ALL_TABS.map((tab) => (
                    <label key={tab.id} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                      <Checkbox
                        checked={pkgTabs.includes(tab.id)}
                        onCheckedChange={() => toggleTab(tab.id, pkgTabs, setPkgTabs)}
                      />
                      {tab.label}
                    </label>
                  ))}
                </div>
                <Button onClick={handleCreatePackage} disabled={creatingPkg} size="sm" variant="secondary">
                  {creatingPkg ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar Pacote"}
                </Button>
              </div>
            </Card>

            {/* Set Access */}
            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground">Atribuir Acesso</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select value={selectedUser} onValueChange={setSelectedUser}>
                  <SelectTrigger><SelectValue placeholder="Selecionar usuário" /></SelectTrigger>
                  <SelectContent>
                    {users.filter((u) => !u.roles.includes("admin")).map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.display_name || u.email} ({u.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 dias</SelectItem>
                    <SelectItem value="15">15 dias</SelectItem>
                    <SelectItem value="30">30 dias</SelectItem>
                    <SelectItem value="unlimited">Indeterminado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-3">
                <Button size="sm" variant={accessMode === "package" ? "default" : "outline"} onClick={() => setAccessMode("package")}>
                  Pacote
                </Button>
                <Button size="sm" variant={accessMode === "custom" ? "default" : "outline"} onClick={() => setAccessMode("custom")}>
                  Personalizado
                </Button>
              </div>
              {accessMode === "package" ? (
                <Select value={selectedPkg} onValueChange={setSelectedPkg}>
                  <SelectTrigger><SelectValue placeholder="Selecionar pacote" /></SelectTrigger>
                  <SelectContent>
                    {packages.map((pkg) => (
                      <SelectItem key={pkg.id} value={pkg.id}>{pkg.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {ALL_TABS.map((tab) => (
                    <label key={tab.id} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                      <Checkbox
                        checked={customTabs.includes(tab.id)}
                        onCheckedChange={() => toggleTab(tab.id, customTabs, setCustomTabs)}
                      />
                      {tab.label}
                    </label>
                  ))}
                </div>
              )}
              <Button onClick={handleSetAccess} disabled={settingAccess} size="sm">
                {settingAccess ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar Acesso"}
              </Button>
            </Card>

            {/* Users List */}
            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground">Usuários ({users.length})</h2>
              <div className="space-y-3">
                {users.map((u) => {
                  const accessInfo = getUserAccessInfo(u);
                  return (
                    <div key={u.id} className="flex items-center justify-between bg-secondary/30 rounded-lg px-4 py-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{u.display_name || u.email}</span>
                          {u.roles.includes("admin") && (
                            <Badge className="text-[10px] bg-primary/20 text-primary">Admin</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant={accessInfo.expired ? "destructive" : "secondary"}
                            className="text-[10px]"
                          >
                            {accessInfo.label}
                          </Badge>
                          {!accessInfo.expired && accessInfo.tabs.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {accessInfo.tabs.join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                      {!u.roles.includes("admin") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteUser(u.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
