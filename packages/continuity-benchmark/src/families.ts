export const continuityDefectFamilies = [
  "knowledge_boundary",
  "body_continuity",
  "identity_transition",
  "inventory_rights",
  "travel_time",
  "foreshadow_payoff",
  "motivation_drift",
  "branch_divergence",
] as const;

export const continuityControlFamilies = ["false_alarm", "incomplete_context"] as const;

export const continuityScenarioFamilies = [
  ...continuityDefectFamilies,
  ...continuityControlFamilies,
] as const;

export type ContinuityDefectFamily = (typeof continuityDefectFamilies)[number];
export type ContinuityScenarioFamily = (typeof continuityScenarioFamilies)[number];
export type ContinuityControlFamily = (typeof continuityControlFamilies)[number];
export type ContinuitySeverity = "P0" | "P1" | "P2";

export interface ContinuityScenarioMetadata {
  severity: ContinuitySeverity;
  samplingPriority: number;
  hasCleanControl: boolean;
}

export const continuityScenarioMetadata = {
  knowledge_boundary: { severity: "P0", samplingPriority: 100, hasCleanControl: true },
  body_continuity: { severity: "P0", samplingPriority: 60, hasCleanControl: true },
  identity_transition: { severity: "P0", samplingPriority: 90, hasCleanControl: true },
  inventory_rights: { severity: "P1", samplingPriority: 40, hasCleanControl: true },
  travel_time: { severity: "P1", samplingPriority: 40, hasCleanControl: true },
  foreshadow_payoff: { severity: "P1", samplingPriority: 80, hasCleanControl: true },
  motivation_drift: { severity: "P2", samplingPriority: 70, hasCleanControl: true },
  branch_divergence: { severity: "P0", samplingPriority: 95, hasCleanControl: false },
} satisfies Record<ContinuityDefectFamily, ContinuityScenarioMetadata>;
