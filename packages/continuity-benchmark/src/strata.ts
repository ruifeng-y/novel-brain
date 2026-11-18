export type VolumePosition = "early" | "middle" | "late";

export function volumePositionFor(chapterCount: number, chapterNumber: number): VolumePosition {
  const ratio = chapterNumber / chapterCount;
  if (ratio <= 1 / 3) {
    return "early";
  }
  if (ratio <= 2 / 3) {
    return "middle";
  }
  return "late";
}
