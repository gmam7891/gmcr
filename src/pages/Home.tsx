import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Shield, LogOut, ArrowRight, BarChart3, Instagram, Tv, Youtube, Monitor, Zap, Search, Video, Target } from "lucide-react";

const modules = [
  {
    id: "icp",
    icon: Target,
    title: "ICP Calc",
    description: "Calcule o perfil de cliente ideal para suas campanhas. Defina métricas de audiência e encontre o influenciador perfeito para seu público-alvo.",
    color: "from-blue-500/20 to-blue-600/10",
  },
  {
    id: "instagram",
    icon: Instagram,
    title: "Instagram",
    description: "Analise perfis de influenciadores no Instagram. Simule campanhas com diferentes formatos (Stories, Reels, Feed) e calcule ROI estimado.",
    color: "from-pink-500/20 to-purple-600/10",
  },
  {
    id: "twitch",
    icon: Tv,
    title: "Twitch",
    description: "Consulte dados de streamers da Twitch: seguidores, média de viewers, tempo de stream e métricas de engajamento em tempo real.",
    color: "from-violet-500/20 to-violet-600/10",
  },
  {
    id: "youtube",
    icon: Youtube,
    title: "YouTube",
    description: "Pesquise canais do YouTube e obtenha estatísticas detalhadas: inscritos, visualizações, taxa de engajamento e performance de vídeos.",
    color: "from-red-500/20 to-red-600/10",
  },
  {
    id: "kick",
    icon: Tv,
    title: "Kick",
    description: "Analise streamers da plataforma Kick com métricas de audiência, seguidores e desempenho de lives.",
    color: "from-green-500/20 to-green-600/10",
  },
  {
    id: "vod",
    icon: Video,
    title: "VOD Analyzer",
    description: "Analise VODs e vídeos gravados. Extraia métricas de visualização, retenção e engajamento para avaliar a performance do conteúdo.",
    color: "from-amber-500/20 to-amber-600/10",
  },
  {
    id: "monitor",
    icon: Monitor,
    title: "Monitor",
    description: "Monitore streamers em tempo real. Acompanhe viewers, status de live, jogos sendo jogados e colete snapshots de audiência ao longo do tempo.",
    color: "from-cyan-500/20 to-cyan-600/10",
  },
  {
    id: "simulator",
    icon: Zap,
    title: "Simulador",
    description: "Simule campanhas de mídia com influenciadores. Calcule CPM, CPV, alcance estimado e compare cenários para otimizar seu investimento.",
    color: "from-yellow-500/20 to-yellow-600/10",
  },
  {
    id: "authenticity",
    icon: Search,
    title: "Authenticity",
    description: "Analise a autenticidade da audiência de streamers. Detecte padrões suspeitos de engajamento e obtenha um score de confiabilidade.",
    color: "from-emerald-500/20 to-emerald-600/10",
  },
];

const Home = () => {
  const { isAdmin, userAccess, signOut } = useAuth();
  const navigate = useNavigate();
  const allowedTabs = userAccess?.allowed_tabs || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-foreground">Starklytic</h1>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            Media Buying Tool v2.3
          </span>
        </div>
        <div className="flex items-center gap-2">
          {userAccess?.expires_at && (
            <span className="text-[10px] text-muted-foreground font-mono">
              Acesso até {new Date(userAccess.expires_at).toLocaleDateString("pt-BR")}
            </span>
          )}
          {isAdmin && (
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} title="Admin">
              <Shield className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={signOut} title="Sair">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Bem-vindo ao Starklytic
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Sua plataforma completa para análise de influenciadores e media buying. 
            Explore os módulos abaixo para começar a analisar dados, simular campanhas e monitorar resultados.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules
            .filter((m) => allowedTabs.includes(m.id))
            .map((mod) => (
              <button
                key={mod.id}
                onClick={() => navigate(`/app?tab=${mod.id}`)}
                className={`group relative text-left rounded-xl border border-border p-5 bg-gradient-to-br ${mod.color} hover:border-primary/40 transition-all duration-200 hover:shadow-md`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 rounded-lg bg-background/80 border border-border">
                    <mod.icon className="h-5 w-5 text-foreground" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{mod.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{mod.description}</p>
              </button>
            ))}
        </div>

        <div className="border border-border rounded-xl p-6 bg-secondary/30 space-y-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Como utilizar
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
            <div className="space-y-1">
              <p className="font-medium text-foreground">1. Escolha o módulo</p>
              <p>Clique em um dos cards acima ou navegue pelas abas na página de ferramentas para acessar a funcionalidade desejada.</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">2. Insira os dados</p>
              <p>Preencha os campos com as informações do influenciador ou campanha que deseja analisar. Cada módulo tem seus inputs específicos.</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">3. Analise e exporte</p>
              <p>Visualize os resultados calculados e exporte relatórios em Excel para compartilhar com sua equipe e tomar decisões embasadas.</p>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <Button onClick={() => navigate("/app")} className="gap-2">
            Acessar Ferramentas <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Home;
