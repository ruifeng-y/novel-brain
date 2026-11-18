export type VolumePosition = "early" | "middle" | "late";

export const reviewStrata = ["early", "middle", "late"] as const;

export function volumeNumberForChapter(chaptersPerVolume: number, chapterNumber: number): number {
  return Math.ceil(chapterNumber / chaptersPerVolume);
}

export function volumePositionFor(volumeCount: number, volumeNumber: number): VolumePosition {
  const ratio = volumeNumber / volumeCount;
  if (ratio <= 1 / 3) {
    return "early";
  }
  if (ratio <= 2 / 3) {
    return "middle";
  }
  return "late";
}
