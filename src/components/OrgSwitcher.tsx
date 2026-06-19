import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";

export function OrgSwitcher() {
  const { orgs, currentOrg, switchOrg } = useAuth();
  if (!orgs.length) return null;

  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 text-muted-foreground" />
      <Select value={currentOrg?.id || ""} onValueChange={switchOrg}>
        <SelectTrigger className="h-9 w-[180px] text-sm">
          <SelectValue placeholder="Selecione organização" />
        </SelectTrigger>
        <SelectContent>
          {orgs.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
              <span className="ml-2 text-xs text-muted-foreground">({o.role})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
