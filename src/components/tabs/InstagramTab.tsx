import { useState, useMemo } from "react";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fmtInt } from "@/lib/formatters";
import { PlatformCampaignSection } from "@/components/platform/PlatformCampaignSection";
import { useLanguage } from "@/contexts/LanguageContext";

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
  reelsEngagementRate?: number;
  storiesEngagementRate?: number;
}

export function InstagramTab() {
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);

  // Delivery inputs (base audience source)
  const [avgReach, setAvgReach] = useState(0);
  const [reelsDeliveries, setReelsDeliveries] = useState(1);
  const [reelsViews, setReelsViews] = useState(0);
  const [storiesDeliveries, setStoriesDeliveries] = useState(0);
  const [storiesViews, setStoriesViews] = useState(0);

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
      if (data.avgReelsViews) setReelsViews(Math.round(data.avgReelsViews * 0.95));
      if (data.storiesViewEstimate) {
        setStoriesViews(Math.round(data.storiesViewEstimate * 0.95));
        setAvgReach(Math.round(data.storiesViewEstimate * 0.95));
      }
      toast.success(`Perfil @${data.username} carregado!`, {
        description: `${fmtInt(data.followers)} seguidores`,
      });
    } catch (err: any) {
      toast.error("Erro ao buscar perfil", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Total exposure across all Reels + Stories deliveries
  const platformReach = useMemo(() => {
    const reelsTotal = reelsViews * Math.max(reelsDeliveries, 0);
    const storiesTotal = storiesViews * Math.max(storiesDeliveries, 0);
    const combined = reelsTotal + storiesTotal;
    return combined > 0 ? combined : avgReach;
  }, [avgReach, reelsViews, reelsDeliveries, storiesViews, storiesDeliveries]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground tracking-tight">{t("ig.title")}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t("ig.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-6">
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
                  <img
                    src={`https://couivtyswlgvyyqiueap.supabase.co/functions/v1/instagram-image-proxy?url=${encodeURIComponent(profile.profilePicUrl)}`}
                    alt={profile.username}
                    className="w-10 h-10 rounded-full object-cover bg-secondary"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
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

          <FieldSection title="Entregas · Reels">
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Quantidade" value={reelsDeliveries} onChange={setReelsDeliveries} step={1} />
              <NumberField label="Views médias" value={reelsViews} onChange={setReelsViews} step={1000} />
            </div>
          </FieldSection>

          <FieldSection title="Entregas · Stories">
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Quantidade" value={storiesDeliveries} onChange={setStoriesDeliveries} step={1} />
              <NumberField label="Views médias" value={storiesViews} onChange={setStoriesViews} step={1000} />
            </div>
          </FieldSection>

          <FieldSection title="Alcance médio (opcional)">
            <NumberField label="Alcance médio" value={avgReach} onChange={setAvgReach} step={1000} />
            <p className="text-[11px] text-muted-foreground">
              Usado como base de público apenas quando não há entregas informadas.
            </p>
          </FieldSection>
        </div>

        <div className="lg:col-span-3">
          <PlatformCampaignSection platformReach={platformReach} platformLabel="Instagram" />
        </div>
      </div>
    </div>
  );
}
