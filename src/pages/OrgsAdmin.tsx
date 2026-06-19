import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, UserPlus, Trash2, Loader2 } from "lucide-react";

interface Org {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  created_at: string;
}

interface Member {
  id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  email?: string | null;
}

export default function OrgsAdmin() {
  const { user, isAdmin, refreshOrgs } = useAuth();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);

  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [creating, setCreating] = useState(false);

  const [selectedOrg, setSelectedOrg] = useState<string>("");
  const [members, setMembers] = useState<Member[]>([]);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<"member" | "admin" | "owner">("member");
  const [addingMember, setAddingMember] = useState(false);

  const loadOrgs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("organizations")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setOrgs((data as Org[]) || []);
    setLoading(false);
  };

  const loadMembers = async (orgId: string) => {
    const { data, error } = await supabase
      .from("organization_members")
      .select("id, user_id, role")
      .eq("org_id", orgId);
    if (error) { toast.error(error.message); return; }

    const rows = (data || []) as Member[];
    // Buscar emails dos profiles
    if (rows.length) {
      const ids = rows.map((r) => r.user_id);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", ids);
      const emailMap = new Map((profs || []).map((p: any) => [p.id, p.email]));
      rows.forEach((r) => (r.email = emailMap.get(r.user_id) || null));
    }
    setMembers(rows);
  };

  useEffect(() => { loadOrgs(); }, []);
  useEffect(() => { if (selectedOrg) loadMembers(selectedOrg); else setMembers([]); }, [selectedOrg]);

  const createOrg = async () => {
    if (!user || !newName.trim() || !newSlug.trim()) {
      toast.error("Nome e slug obrigatórios");
      return;
    }
    setCreating(true);
    const { error } = await supabase
      .from("organizations")
      .insert({ name: newName.trim(), slug: newSlug.trim().toLowerCase(), owner_user_id: user.id } as any);
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Organização criada");
    setNewName(""); setNewSlug("");
    await loadOrgs();
    await refreshOrgs();
  };

  const addMember = async () => {
    if (!selectedOrg || !newMemberEmail.trim()) return;
    setAddingMember(true);
    // Achar user pelo email no profiles
    const { data: prof } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", newMemberEmail.trim().toLowerCase())
      .maybeSingle();
    if (!prof) {
      setAddingMember(false);
      toast.error("Usuário não encontrado. Ele precisa ter conta no app primeiro.");
      return;
    }
    const { error } = await supabase
      .from("organization_members")
      .insert({ org_id: selectedOrg, user_id: (prof as any).id, role: newMemberRole } as any);
    setAddingMember(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Membro adicionado");
    setNewMemberEmail("");
    await loadMembers(selectedOrg);
  };

  const removeMember = async (id: string) => {
    if (!confirm("Remover membro?")) return;
    const { error } = await supabase.from("organization_members").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await loadMembers(selectedOrg);
  };

  if (!isAdmin) {
    return <div className="p-8">Apenas admins do sistema podem gerenciar organizações.</div>;
  }

  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <Building2 className="h-5 w-5" />
        <h1 className="text-2xl font-bold">Organizações</h1>
      </div>

      <Card className="p-4 space-y-3">
        <h2 className="font-semibold">Criar nova organização</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input placeholder="Nome (ex: ACME Casino)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Input placeholder="Slug (ex: acme)" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} />
          <Button onClick={createOrg} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar"}
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="font-semibold">Organizações existentes</h2>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <div className="space-y-2">
            {orgs.map((o) => (
              <div key={o.id} className="flex items-center justify-between p-3 border rounded-md">
                <div>
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-muted-foreground">{o.slug} · {new Date(o.created_at).toLocaleDateString()}</div>
                </div>
                <Button size="sm" variant={selectedOrg === o.id ? "default" : "outline"} onClick={() => setSelectedOrg(o.id)}>
                  Gerenciar membros
                </Button>
              </div>
            ))}
            {!orgs.length && <div className="text-sm text-muted-foreground">Nenhuma organização ainda.</div>}
          </div>
        )}
      </Card>

      {selectedOrg && (
        <Card className="p-4 space-y-3">
          <h2 className="font-semibold">Membros de {orgs.find((o) => o.id === selectedOrg)?.name}</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Input
              placeholder="email do usuário"
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              className="md:col-span-2"
            />
            <Select value={newMemberRole} onValueChange={(v: any) => setNewMemberRole(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={addMember} disabled={addingMember}>
              {addingMember ? <Loader2 className="h-4 w-4 animate-spin" /> : <><UserPlus className="h-4 w-4 mr-1" /> Adicionar</>}
            </Button>
          </div>
          <div className="space-y-2 pt-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between p-2 border rounded">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{m.role}</Badge>
                  <span className="text-sm">{m.email || m.user_id}</span>
                </div>
                <Button size="icon" variant="ghost" onClick={() => removeMember(m.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {!members.length && <div className="text-sm text-muted-foreground">Sem membros.</div>}
          </div>
        </Card>
      )}
    </div>
  );
}
