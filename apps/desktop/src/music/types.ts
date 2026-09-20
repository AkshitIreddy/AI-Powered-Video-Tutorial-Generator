export type MusicMood = "calm" | "curious" | "focused" | "hopeful" | "playful" | "reflective" | "energetic";

export interface MusicCandidate {
  id: string;
  status: "ready" | "accepted" | "rejected" | "superseded";
  artifactHash: string;
  mediaType: string;
  title: string;
  creator: string;
  durationSeconds: number | null;
  provider: "openverse";
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  mood: MusicMood;
  matchScore: number;
  assetId?: string;
}

const moods = new Set<MusicMood>(["calm", "curious", "focused", "hopeful", "playful", "reflective", "energetic"]);
const statuses = new Set<MusicCandidate["status"]>(["ready", "accepted", "rejected", "superseded"]);

export function parseMusicCandidates(value: unknown): MusicCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): MusicCandidate[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string"
      || typeof record.status !== "string"
      || !statuses.has(record.status as MusicCandidate["status"])
      || typeof record.artifactHash !== "string"
      || !/^[0-9a-f]{64}$/u.test(record.artifactHash)
      || typeof record.mediaType !== "string"
      || !record.mediaType.startsWith("audio/")
      || typeof record.title !== "string"
      || typeof record.creator !== "string"
      || record.provider !== "openverse"
      || typeof record.sourceUrl !== "string"
      || !record.sourceUrl.startsWith("https://")
      || typeof record.license !== "string"
      || typeof record.licenseUrl !== "string"
      || !record.licenseUrl.startsWith("https://creativecommons.org/")
      || typeof record.attribution !== "string"
      || typeof record.mood !== "string"
      || !moods.has(record.mood as MusicMood)
      || typeof record.matchScore !== "number"
      || !Number.isFinite(record.matchScore)
    ) return [];
    const durationSeconds = record.durationSeconds;
    if (durationSeconds !== null && durationSeconds !== undefined && (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0)) return [];
    return [{
      id: record.id,
      status: record.status as MusicCandidate["status"],
      artifactHash: record.artifactHash,
      mediaType: record.mediaType,
      title: record.title,
      creator: record.creator,
      durationSeconds: typeof durationSeconds === "number" ? durationSeconds : null,
      provider: "openverse",
      sourceUrl: record.sourceUrl,
      license: record.license,
      licenseUrl: record.licenseUrl,
      attribution: record.attribution,
      mood: record.mood as MusicMood,
      matchScore: record.matchScore,
      ...(typeof record.assetId === "string" ? { assetId: record.assetId } : {}),
    }];
  });
}
