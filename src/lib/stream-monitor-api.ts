import { supabase } from "@/integrations/supabase/client";

export interface MonitoredStreamer {
  id: string;
  login: string;
  display_name: string | null;
  twitch_id: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface GameReach {
  game: string;
  avgViewers: number;
  peakViewers: number;
  totalMinutes: number;
  totalViewerMinutes: number;
  impressions: number;
  snapshots: number;
}

export interface TimelinePoint {
  viewer_count: number;
  game_name: string | null;
  is_live: boolean;
  captured_at: string;
}

async function callMonitor(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('stream-monitor', { body });
  if (error) throw new Error(error.message);
  return data;
}

export async function addStreamer(login: string): Promise<MonitoredStreamer> {
  const result = await callMonitor({ action: 'add_streamer', login });
  return result.streamer;
}

export async function removeStreamer(login: string): Promise<void> {
  await callMonitor({ action: 'remove_streamer', login });
}

export async function listStreamers(): Promise<MonitoredStreamer[]> {
  const result = await callMonitor({ action: 'list_streamers' });
  return result.streamers ?? [];
}

export async function pollNow(): Promise<{ snapshots: number; live: number }> {
  const result = await callMonitor({ action: 'poll' });
  return { snapshots: result.snapshots ?? 0, live: result.live ?? 0 };
}

export async function getReach(login?: string, days = 30): Promise<{ reach: GameReach[]; totalSnapshots: number }> {
  const result = await callMonitor({ action: 'get_reach', login, days });
  return { reach: result.reach ?? [], totalSnapshots: result.totalSnapshots ?? 0 };
}

export async function getTimeline(login: string, hours = 24): Promise<TimelinePoint[]> {
  const result = await callMonitor({ action: 'get_timeline', login, hours });
  return result.timeline ?? [];
}
