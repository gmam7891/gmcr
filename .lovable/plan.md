

## Diagnóstico: Por que o VOD Analyzer retorna 0 resultados

**Causa raiz**: As URLs de thumbnail geradas (`thumb60-1280x720.jpg`, `thumb360-1280x720.jpg`, etc.) **não existem** no CDN da Twitch. O gateway de IA tenta buscar essas imagens e recebe **404 Not Found**, então falha com erro 400 em todos os batches.

O sistema já possui uma função `getStoryboardUrls` que busca as URLs reais de storyboard via GraphQL da Twitch, mas ela **nunca é chamada** pelo fluxo de análise. Ao invés disso, `generateSeekThumbnails` inventa URLs que não funcionam.

## Plano de Correção

### 1. Refatorar `analyzeWithAI` no VodTab.tsx para usar storyboards reais

Substituir a chamada a `generateSeekThumbnails` por `getStoryboardUrls`:
- Chamar `getStoryboardUrls(vodId, durationSecs)` para obter as URLs reais dos sprites de storyboard
- Essas URLs são sprites (grids de imagens), que a IA já sabe analisar pois o prompt diz "Se a imagem for uma FOLHA DE SPRITE (storyboard), analise CADA miniatura individualmente"
- Enviar as URLs dos strips diretamente para `analyzeVodFrames` com timestamps calculados baseados no `interval` retornado
- Limitar a ~40 strips para não estourar limites

### 2. Calcular timestamps corretamente para storyboards

Cada strip contém `cols × rows` frames com intervalo fixo (ex: 19 segundos entre frames). Calcular o timestamp médio de cada strip para mapeamento na timeline.

### 3. Adicionar tratamento de erro visível na UI

Quando a IA retornar 0 detecções ou erros 402/400, mostrar uma mensagem clara ao usuário ao invés de simplesmente exibir "0 jogos encontrados".

### 4. Fallback para seek thumbnails validadas

Se `getStoryboardUrls` falhar (VOD sem storyboard disponível), tentar uma abordagem de HEAD request para validar se as URLs de seek thumbnail existem antes de enviar ao modelo.

---

### Arquivos a modificar

| Arquivo | Mudança |
|---|---|
| `src/components/tabs/VodTab.tsx` | Trocar `generateSeekThumbnails` por `getStoryboardUrls`, calcular timestamps, mostrar erros |
| `src/lib/twitch-api.ts` | Nenhuma mudança necessária (já tem `getStoryboardUrls`) |
| `supabase/functions/twitch-api/index.ts` | Nenhuma mudança necessária (já tem a action `get_storyboard_urls`) |

