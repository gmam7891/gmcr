import { CAMPAIGN_TYPES, type CampaignType } from "@/lib/instagram/campaignTypes";

/**
 * Platforms whose campaign stages (etapas) can be gated per client contract.
 * The `key` is the canonical entitlement key stored in the DB; `label` is the
 * human label used both in the admin UI and passed as `platformLabel` to
 * PlatformCampaignSection.
 */
export const STAGE_PLATFORMS = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "twitch", label: "Twitch" },
  { key: "youtube", label: "YouTube" },
  { key: "kick", label: "Kick" },
] as const;

export type StagePlatformKey = (typeof STAGE_PLATFORMS)[number]["key"];

/** Entitlement map: platform key -> the campaign stages the client contracted. */
export type AllowedStages = Partial<Record<string, CampaignType[]>>;

/** All stage values in canonical order. */
export const ALL_STAGE_VALUES: CampaignType[] = CAMPAIGN_TYPES.map((t) => t.value);

/** Normalize a human platform label ("Instagram", "TikTok"…) to its entitlement key. */
export function platformKey(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Resolve which stages a user may use on a given platform.
 * - `allowed` null/undefined  → all stages (unconfigured / backward compatible).
 * - platform key absent        → all stages for that platform.
 * - platform key present       → exactly that list (filtered to valid values, canonical order).
 */
export function resolveEnabledStages(
  allowed: AllowedStages | null | undefined,
  label: string,
): CampaignType[] {
  if (!allowed) return ALL_STAGE_VALUES;
  const list = allowed[platformKey(label)];
  if (!Array.isArray(list)) return ALL_STAGE_VALUES;
  const set = new Set(list);
  return ALL_STAGE_VALUES.filter((v) => set.has(v));
}

/** A fresh entitlement map with every platform enabled for every stage. */
export function defaultAllowedStages(): AllowedStages {
  return Object.fromEntries(
    STAGE_PLATFORMS.map((p) => [p.key, [...ALL_STAGE_VALUES]]),
  );
}
