import { apiErrorSchema, workResponseSchema, type WorkOverview } from "@novel-brain/contracts";

const ACTIVE_BRANCH_KEY_PREFIX = "nb_active_branch_id:";

export function getActiveBranchId(workId: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.localStorage.getItem(`${ACTIVE_BRANCH_KEY_PREFIX}${workId}`) ?? undefined;
}

export function workOverviewUrl(workId: string): string {
  const branchId = getActiveBranchId(workId);
  return branchId
    ? `/api/v1/works/${workId}?branchId=${encodeURIComponent(branchId)}`
    : `/api/v1/works/${workId}`;
}

export async function fetchWorkOverview(workId: string): Promise<WorkOverview> {
  const response = await fetch(workOverviewUrl(workId), { cache: "no-store" });
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
    throw new Error(parsed.success ? parsed.data.error.message : "加载作品失败");
  }
  return workResponseSchema.parse(await response.json()).data;
}

export function selectActiveBranch(workId: string, branchId: string): void {
  window.localStorage.setItem(`${ACTIVE_BRANCH_KEY_PREFIX}${workId}`, branchId);
  window.location.reload();
}

export function clearActiveBranch(workId: string): void {
  window.localStorage.removeItem(`${ACTIVE_BRANCH_KEY_PREFIX}${workId}`);
}
