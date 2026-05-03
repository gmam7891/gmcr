import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Camera, X, CheckCircle2, ImagePlus } from "lucide-react";

const MAX_FILES = 5;
const MAX_FILE_SIZE_MB = 8;

interface UploadedImage {
  file: File;
  preview: string;
  dataUrl: string;
}

interface ScreenshotTrainingTabProps {
  onTrained?: () => void;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ScreenshotTrainingTab({ onTrained }: ScreenshotTrainingTabProps) {
  const [gameName, setGameName] = useState("");
  const [providerName, setProviderName] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [training, setTraining] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_FILES - images.length;
    if (remaining <= 0) {
      toast.error(`Máximo de ${MAX_FILES} imagens`);
      return;
    }
    const toProcess = Array.from(files).slice(0, remaining);
    setUploading(true);
    try {
      const newImages: UploadedImage[] = [];
      for (const file of toProcess) {
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name}: não é imagem`);
          continue;
        }
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          toast.error(`${file.name}: maior que ${MAX_FILE_SIZE_MB}MB`);
          continue;
        }
        const dataUrl = await fileToDataUrl(file);
        newImages.push({
          file,
          preview: URL.createObjectURL(file),
          dataUrl,
        });
      }
      setImages((prev) => [...prev, ...newImages]);
    } catch (e: any) {
      toast.error(e.message || "Erro ao ler imagens");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.preview);
      return next;
    });
  };

  const handleTrain = async () => {
    if (!gameName.trim() || !providerName.trim()) {
      toast.error("Preencha nome do jogo e provedora");
      return;
    }
    if (images.length === 0) {
      toast.error("Envie pelo menos 1 print");
      return;
    }
    setTraining(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-vision-test", {
        body: {
          action: "train_from_screenshots",
          game_name: gameName.trim(),
          provider_name: providerName.trim(),
          image_data_urls: images.map((i) => i.dataUrl),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setLastResult(data);
      toast.success(
        `✅ ${gameName} ${data.updated ? "atualizado" : "treinado"} com ${images.length} print(s)`,
      );
      // Reset
      images.forEach((i) => URL.revokeObjectURL(i.preview));
      setImages([]);
      setGameName("");
      setProviderName("");
      onTrained?.();
    } catch (e: any) {
      toast.error(e.message || "Treinamento falhou");
    } finally {
      setTraining(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            Treinar Jogo com Prints
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Envie de 1 a {MAX_FILES} prints do jogo (lobby, gameplay, bônus). A IA
            extrai o Visual DNA e adiciona/atualiza na biblioteca como{" "}
            <Badge variant="secondary" className="text-[10px]">trained</Badge>.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            placeholder="Nome do jogo (ex: Sweet Bonanza 1000)"
            value={gameName}
            onChange={(e) => setGameName(e.target.value)}
            disabled={training}
          />
          <Input
            placeholder="Provedora (ex: Pragmatic Play)"
            value={providerName}
            onChange={(e) => setProviderName(e.target.value)}
            disabled={training}
          />
        </div>

        {/* Upload area */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
            disabled={training || uploading || images.length >= MAX_FILES}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={training || uploading || images.length >= MAX_FILES}
            className="w-full border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ImagePlus className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-foreground">
              {images.length >= MAX_FILES
                ? `Máximo de ${MAX_FILES} imagens atingido`
                : "Clique para enviar prints"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              PNG / JPG / WEBP — até {MAX_FILE_SIZE_MB}MB cada — {images.length}/{MAX_FILES}
            </p>
          </button>
        </div>

        {/* Previews */}
        {images.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {images.map((img, idx) => (
              <div
                key={idx}
                className="relative group rounded-lg overflow-hidden border border-border bg-secondary/30"
              >
                <img
                  src={img.preview}
                  alt={`Print ${idx + 1}`}
                  className="w-full h-24 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(idx)}
                  disabled={training}
                  className="absolute top-1 right-1 bg-background/80 hover:bg-destructive hover:text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remover"
                >
                  <X className="h-3 w-3" />
                </button>
                <span className="absolute bottom-1 left-1 text-[10px] bg-background/80 px-1.5 py-0.5 rounded">
                  #{idx + 1}
                </span>
              </div>
            ))}
          </div>
        )}

        <Button
          onClick={handleTrain}
          disabled={
            training || uploading || images.length === 0 ||
            !gameName.trim() || !providerName.trim()
          }
          className="w-full sm:w-auto"
        >
          {training ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Treinando com IA...
            </>
          ) : (
            <>
              <Camera className="h-4 w-4 mr-2" />
              Treinar com {images.length || 0} print(s)
            </>
          )}
        </Button>
      </Card>

      {/* Last result */}
      {lastResult?.visual_dna && (
        <Card className="p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Último Visual DNA extraído
            <Badge variant="outline" className="text-[10px]">
              {lastResult.elapsed_ms}ms
            </Badge>
          </h3>

          {Array.isArray(lastResult.visual_dna.detection_keywords) && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Keywords detectadas
              </p>
              <div className="flex flex-wrap gap-1">
                {lastResult.visual_dna.detection_keywords.map((kw: string, i: number) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">
                    {kw}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(lastResult.visual_dna.unique_visual_traits) && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Traços únicos
              </p>
              <ul className="space-y-1">
                {lastResult.visual_dna.unique_visual_traits.map((t: string, i: number) => (
                  <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                    <span className="text-primary mt-0.5">•</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(lastResult.visual_dna.color_palette) && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Paleta
              </p>
              <div className="flex gap-1">
                {lastResult.visual_dna.color_palette.map((c: string, i: number) => (
                  <div
                    key={i}
                    className="h-6 w-6 rounded border border-border"
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
