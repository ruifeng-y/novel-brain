import type {
  ImportCandidateStatus,
  ImportCandidateType,
  ImportUnparsed,
} from "@novel-brain/contracts";

export interface ParsedImportCandidate {
  type: ImportCandidateType;
  name: string;
  summary: string;
  payload: Record<string, unknown>;
  sourceExcerpt: string;
  confidence: number;
  status: ImportCandidateStatus;
}

export interface ParsedSettingsImport {
  candidates: ParsedImportCandidate[];
  conflicts: ParsedImportConflict[];
  unparsed: ImportUnparsed[];
}

export interface ParsedImportConflict {
  type: "contradictory_setting";
  summary: string;
  primaryCandidateIndex: number;
  secondaryCandidateIndex: number;
}

const LABELS: Record<string, { type: ImportCandidateType; confidence: number }> = {
  人物: { type: "character", confidence: 0.94 },
  角色: { type: "character", confidence: 0.94 },
  势力: { type: "faction", confidence: 0.94 },
  地图: { type: "map", confidence: 0.94 },
  力量体系: { type: "power_system", confidence: 0.94 },
  体系: { type: "power_system", confidence: 0.82 },
  金手指: { type: "golden_finger", confidence: 0.94 },
};

export function parseSettingsText(text: string): ParsedSettingsImport {
  const candidates: ParsedImportCandidate[] = [];
  const unparsed: ImportUnparsed[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const sourceExcerpt = rawLine.trim();
    if (!sourceExcerpt) {
      continue;
    }

    const match = /^(人物|角色|势力|地图|力量体系|体系|金手指)[：:]\s*(.+)$/.exec(sourceExcerpt);
    if (!match) {
      unparsed.push({
        sourceExcerpt,
        reason: "无法识别为人物、势力、地图、力量体系或金手指",
      });
      continue;
    }

    const label = LABELS[match[1] ?? ""];
    const content = (match[2] ?? "").trim();
    if (!label || !content) {
      unparsed.push({
        sourceExcerpt,
        reason: "设定类型后缺少可识别内容",
      });
      continue;
    }

    const segments = content
      .split(/[，,；;]/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    const namePart = (segments[0] ?? "").replace(/[。.!！?？]+$/u, "").trim();
    const summary = segments.slice(1).join("，");
    const names =
      label.type === "faction" && namePart.includes("、")
        ? namePart
            .split("、")
            .map((name) => name.trim())
            .filter(Boolean)
        : [namePart];

    for (const name of names) {
      candidates.push({
        type: label.type,
        name,
        summary,
        payload: { name, summary },
        sourceExcerpt,
        confidence: label.confidence,
        status: label.confidence >= 0.9 ? "accepted" : "pending",
      });
    }
  }

  const conflicts = detectConflicts(candidates);
  return { candidates, conflicts, unparsed };
}

function detectConflicts(candidates: ParsedImportCandidate[]): ParsedImportConflict[] {
  const bySetting = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    const key = `${candidate.type}:${candidate.name}`;
    const indexes = bySetting.get(key) ?? [];
    indexes.push(index);
    bySetting.set(key, indexes);
  });

  const conflicts: ParsedImportConflict[] = [];
  for (const indexes of bySetting.values()) {
    if (indexes.length < 2) {
      continue;
    }
    const primaryIndex = indexes[0];
    if (primaryIndex === undefined) {
      continue;
    }
    const primary = candidates[primaryIndex];
    if (!primary) {
      continue;
    }
    const secondaryIndex = indexes.find((index) => {
      const secondary = candidates[index];
      return secondary && primary.summary !== secondary.summary;
    });
    if (secondaryIndex === undefined) {
      continue;
    }
    const secondary = candidates[secondaryIndex];
    if (!secondary) {
      continue;
    }
    primary.status = "conflict";
    secondary.status = "conflict";
    conflicts.push({
      type: "contradictory_setting",
      summary: `${primary.name}的设定存在不同说法：${primary.summary || "未说明"} / ${secondary.summary || "未说明"}`,
      primaryCandidateIndex: primaryIndex,
      secondaryCandidateIndex: secondaryIndex,
    });
  }
  return conflicts;
}
