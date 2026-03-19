import { supabase } from "@/integrations/supabase/client";

interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
  description: string;
  broadcaster_type: string;
  view_count: number;
}

interface TwitchStream {
  id: string;
  user_login: string;
  game_id: string;
  game_name: string;
  title: string;
  viewer_count: number;
  started_at: string;
  type: string;
}

interface TwitchVod {
  id: string;
  user_id: string;
  user_login: string;
  title: string;
  url: string;
  created_at: string;
  duration: string;
  view_count: number;
  thumbnail_url: string;
  stream_id: string;
}

interface VodChapter {
  description: string;
  positionSeconds: number;
  durationSeconds: number;
  game: string;
  gameId: string | null;
  gameBoxArt: string | null;
}

interface SullyGnomeStats {
  avgViewers: number | null;
  hoursWatched: number | null;
  followersGained: number | null;
  peakViewers: number | null;
  hoursStreamed: number | null;
  totalStreams: number | null;
  streams: SullyGnomeStream[];
  error?: string;
}

interface SullyGnomeStream {
  date: string;
  hours: number;
  avgViewers: number;
  peakViewers: number;
  watchHours: number;
  followers: number;
}

interface AiGameDetection {
  game: string;
  provider: string | null;
  category: string;
  confidence: string;
}

async function callTwitch(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('twitch-api', { body });
  if (error) throw new Error(error.message);
  return data;
}

export async function getUser(login: string): Promise<TwitchUser | null> {
  const result = await callTwitch({ action: 'get_user', login });
  return result?.data?.[0] ?? null;
}

export async function getStream(login: string): Promise<TwitchStream | null> {
  const result = await callTwitch({ action: 'get_stream', login });
  return result?.data?.[0] ?? null;
}

export async function getVods(userId: string, count = 20): Promise<TwitchVod[]> {
  const result = await callTwitch({ action: 'get_vods', user_id: userId, vod_count: count });
  return result?.data ?? [];
}

export async function getVod(vodId: string): Promise<TwitchVod | null> {
  const result = await callTwitch({ action: 'get_vod', vod_id: vodId });
  return result?.data?.[0] ?? null;
}

export async function getVodChapters(vodId: string): Promise<VodChapter[]> {
  const result = await callTwitch({ action: 'get_vod_chapters', vod_id: vodId });
  return result?.chapters ?? [];
}

export async function scrapeSullyGnome(login: string): Promise<SullyGnomeStats> {
  const result = await callTwitch({ action: 'scrape_sullygnome', login });
  return result as SullyGnomeStats;
}

export async function analyzeVodFrames(thumbnailUrls: string[], vodTitle?: string): Promise<AiGameDetection[]> {
  const result = await callTwitch({ action: 'analyze_vod_frames', thumbnail_urls: thumbnailUrls, vod_title: vodTitle });
  return result?.games ?? [];
}

export function parseDuration(s: string): number {
  if (!s) return 0;
  let h = 0, m = 0, sec = 0;
  const mh = s.match(/(\d+)h/);
  const mm = s.match(/(\d+)m/);
  const ms = s.match(/(\d+)s/);
  if (mh) h = parseInt(mh[1]);
  if (mm) m = parseInt(mm[1]);
  if (ms) sec = parseInt(ms[1]);
  return h * 60 + m + sec / 60;
}

export function formatDuration(s: string): string {
  const mins = parseDuration(s);
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}m` : `${m}m`;
}

export function formatSeconds(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m`;
  return `${m}m`;
}

export function getVodThumbnailAtOffset(thumbnailUrl: string, offsetSeconds: number, width = 640, height = 360): string {
  // Twitch VOD thumbnails support time offset by replacing the thumbnail URL pattern
  return thumbnailUrl
    .replace('%{width}', String(width))
    .replace('%{height}', String(height))
    .replace(/-preview-\d+x\d+\.jpg/, `-preview-${width}x${height}.jpg`);
}

export type { TwitchUser, TwitchStream, TwitchVod, VodChapter, SullyGnomeStats, SullyGnomeStream, AiGameDetection };
