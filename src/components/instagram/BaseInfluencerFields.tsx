import { NumberField, FieldSection } from "@/components/FieldGroup";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fmtInt } from "@/lib/formatters";
import { useState } from "react";

interface ProfileData {
  username: string;
  fullName: string;
  profilePicUrl: string;
  followers: number;
  avgReelsViews: number;
  engagementRate: number;
  isVerified: boolean;
  storiesViewEstimate: number;
  estimatedCtr: number;
}

interface Props {
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
  username: string;
  setUsername: (v: string) => void;
}

export function BaseInfluencerFields({ values, onChange, username, setUsername }: Props) {
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);

  const fetchProfile = async () => {
    if (!username.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-profile", {
        body: { username: username.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setProfile(data);
      onChange("followers", data.followers);
      if (data.avgReelsViews) onChange("reelsViews", Math.round(data.avgReelsViews * 0.95));
      if (data.engagementRate) onChange("reelsEngagement", Math.round(data.engagementRate * 100) / 100);
      if (data.storiesViewEstimate) {
        onChange("storiesViews", Math.round(data.storiesViewEstimate * 0.95));
        onChange("avgReach", Math.round(data.storiesViewEstimate * 0.95));
      }

      toast.success(`Perfil @${data.username} carregado!`, {
        description: `${fmtInt(data.followers)} seguidores · ${data.engagementRate.toFixed(2)}% engajamento`,
      });
    } catch (err: any) {
      toast.error("Erro ao buscar perfil", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <FieldSection title="Buscar perfil">
        <div className="flex gap-2">
          <Input
            placeholder="@username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchProfile()}
            className="font-mono"
          />
          <Button onClick={fetchProfile} disabled={loading} size="sm" className="shrink-0">
            {loading ? "Buscando…" : "Buscar"}
          </Button>
        </div>
        {profile && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 border border-border mt-2">
            {profile.profilePicUrl && (
              <img src={profile.profilePicUrl} alt={profile.username} className="w-10 h-10 rounded-full" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-sm truncate">@{profile.username}</span>
                {profile.isVerified && <span className="text-primary text-xs">✓</span>}
              </div>
              <span className="text-xs text-muted-foreground">
                {fmtInt(profile.followers)} seg · {profile.engagementRate.toFixed(2)}% eng
              </span>
            </div>
          </div>
        )}
      </FieldSection>

      <FieldSection title="Dados do influenciador">
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Seguidores totais" value={values.followers} onChange={(v) => onChange("followers", v)} step={1000} />
          <NumberField label="Alcance médio por conteúdo" value={values.avgReach} onChange={(v) => onChange("avgReach", v)} step={1000} />
          <NumberField label="Fee do influenciador" value={values.influencerFee} onChange={(v) => onChange("influencerFee", v)} step={1000} suffix="R$" />
        </div>
      </FieldSection>

      <FieldSection title="Entregas · Reels">
        <div className="grid grid-cols-3 gap-3">
          <NumberField label="Quantidade" value={values.reelsDeliveries} onChange={(v) => onChange("reelsDeliveries", v)} step={1} />
          <NumberField label="Views médias" value={values.reelsViews} onChange={(v) => onChange("reelsViews", v)} step={1000} />
          <NumberField label="Engajamento médio (%)" value={values.reelsEngagement} onChange={(v) => onChange("reelsEngagement", v)} step={0.1} suffix="%" />
        </div>
      </FieldSection>

      <FieldSection title="Entregas · Stories">
        <div className="grid grid-cols-3 gap-3">
          <NumberField label="Quantidade" value={values.storiesDeliveries} onChange={(v) => onChange("storiesDeliveries", v)} step={1} />
          <NumberField label="Views médias" value={values.storiesViews} onChange={(v) => onChange("storiesViews", v)} step={1000} />
          <NumberField label="Engajamento médio (%)" value={values.storiesEngagement} onChange={(v) => onChange("storiesEngagement", v)} step={0.1} suffix="%" />
        </div>
      </FieldSection>
    </div>
  );
}
