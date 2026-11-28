import type {
  BlueprintBudget,
  BlueprintEstimate,
  GenerateBlueprintJob,
  WorkGenre,
  WorkScaleTarget,
} from "@novel-brain/contracts";

export interface BlueprintJobProvision {
  blueprintId: string;
  jobId: string;
  userId: string;
  workId: string;
  branchId: string;
  modelConfigId: string | null;
  inputHash: string;
  estimate: BlueprintEstimate;
  budget: BlueprintBudget;
  jobPayload: GenerateBlueprintJob;
}

export interface PrepareIdeaBlueprintInput {
  userId: string;
  workId: string;
  branchId: string;
  title: string;
  idea: string;
  genre: WorkGenre;
  scaleTarget: WorkScaleTarget;
  chapterLengthTarget: number;
  templatePackId: string;
  budgetOverride?: BlueprintBudget;
}

export interface BlueprintAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}
