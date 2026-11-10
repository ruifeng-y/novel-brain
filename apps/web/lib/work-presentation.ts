import type { Work } from "@novel-brain/contracts";

export function branchLabel(name: string): string {
  return name === "main" ? "主线" : name;
}

export function isWorkReadonly(
  workStatus: Work["status"],
  branchStatus: "active" | "archived",
): boolean {
  return workStatus === "archived" || workStatus === "completed" || branchStatus === "archived";
}

export function readonlyScopeLabel(
  workStatus: Work["status"],
  branchStatus: "active" | "archived",
): string {
  return workStatus === "archived" || workStatus === "completed"
    ? "当前作品只读"
    : branchStatus === "archived"
      ? "当前创作线只读"
      : "";
}
