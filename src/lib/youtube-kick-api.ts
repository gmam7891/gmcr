import { supabase } from "@/integrations/supabase/client";

const FUNC = 'youtube-kick-api';

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(FUNC, { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

// ====== YouTube ======

export interface YouTubeChannel {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  customUrl: string;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string;
  durationMinutes: number;
}

export async function getYouTubeChannel(handle: string): Promise<YouTubeChannel> {
  return invoke({ action: 'youtube_get_channel', handle });
}

export async function getYouTubeVideos(channelId: string, maxResults = 20): Promise<YouTubeVideo[]> {
  const data = await invoke({ action: 'youtube_get_videos', channel_id: channelId, max_results: maxResults });
  return data.videos || [];
}

// ====== Kick ======

export interface KickChannel {
  id: number;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  followers: number;
  isLive: boolean;
  verified: boolean;
  livestream: {
    title: string;
    viewers: number;
    category: string;
    startedAt: string;
  } | null;
}

export interface KickVideo {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  viewCount: number;
  duration: string;
  durationMinutes: number;
  createdAt: string;
  categories: string[];
}

export async function getKickChannel(username: string): Promise<KickChannel> {
  return invoke({ action: 'kick_get_channel', username });
}

export async function getKickVideos(username: string): Promise<KickVideo[]> {
  const data = await invoke({ action: 'kick_get_videos', username });
  return data.videos || [];
}

// ====== Shared AI analysis ======

export interface GameDetection {
  game: string;
  provider: string | null;
  category: string;
  confidence: string;
}

export async function analyzeThumbnails(thumbnailUrls: string[], title: string, platform: string): Promise<GameDetection[]> {
  const data = await invoke({ action: 'analyze_thumbnails', thumbnail_urls: thumbnailUrls, title, platform });
  return data.games || [];
}

// ====== Helpers ======

export function formatYTDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '0:00';
  const h = parseInt(match[1] || '0');
  const m = parseInt(match[2] || '0');
  const s = parseInt(match[3] || '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
