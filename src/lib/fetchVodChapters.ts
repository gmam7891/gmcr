import { supabase } from "@/integrations/supabase/client";

export interface VodChapterSegment {
  game: string | null;
  gameId: string | null;
  startMs: number;
  endMs: number;
  durationMs: number;
  reportedDurationMs: number | null;
  source: "twitch_chapter" | "twitch_chapter_implicit";
}

export interface VodChaptersResult {
  videoId: string;
  lengthMs: number;
  segmentCount: number;
  hasChapters: boolean;
  segments: VodChapterSegment[];
}

export async function fetchVodChapters(videoId: string): Promise<VodChaptersResult> {
  const { data, error } = await supabase.functions.invoke("twitch-vod-chapters", {
    body: { videoId },
  });
  if (error) throw error;
  return data as VodChaptersResult;
}
