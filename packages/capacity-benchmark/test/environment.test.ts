import { describe, expect, it } from "vitest";

import {
  CAPACITY_COMPOSE_SERVICES,
  isCertificationEligible,
  summarizeContainerBudget,
  type DockerContainerLimit,
} from "../src/environment";

const approvedLimits: DockerContainerLimit[] = [
  container("api", 2, 3 * 1024 ** 3),
  container("postgres", 2, 4 * 1024 ** 3),
  container("redis", 0.5, 1024 ** 3),
  container("minio", 1.5, 3 * 1024 ** 3),
  container("worker", 2, 5 * 1024 ** 3),
];

describe("summarizeContainerBudget", () => {
  it("accepts a complete service set within the approved resource budget", () => {
    const budget = summarizeContainerBudget("novel-brain-capacity", approvedLimits);

    expect(budget.expectedServices).toEqual([...CAPACITY_COMPOSE_SERVICES]);
    expect(budget.observedServices).toEqual([...CAPACITY_COMPOSE_SERVICES].sort());
    expect(budget.cpuCores).toBe(8);
    expect(budget.memoryBytes).toBe(16 * 1024 ** 3);
    expect(budget.matchesApprovedBudget).toBe(true);
  });

  it("rejects unconstrained services and missing services", () => {
    const budget = summarizeContainerBudget("novel-brain-capacity", [
      ...approvedLimits.slice(0, 4),
      container("worker", null, null),
    ]);

    expect(budget.complete).toBe(true);
    expect(budget.constrained).toBe(false);
    expect(budget.matchesApprovedBudget).toBe(false);

    const missing = summarizeContainerBudget(
      "novel-brain-capacity",
      approvedLimits.filter((limit) => limit.service !== "minio"),
    );
    expect(missing.complete).toBe(false);
    expect(missing.matchesApprovedBudget).toBe(false);
  });

  it("rejects a container budget above the approved host", () => {
    const budget = summarizeContainerBudget("novel-brain-capacity", [
      ...approvedLimits.slice(0, 4),
      container("worker", 3, 5 * 1024 ** 3),
    ]);

    expect(budget.withinApprovedCpu).toBe(false);
    expect(budget.matchesApprovedBudget).toBe(false);
  });

  it("rejects a container budget below the approved host", () => {
    const budget = summarizeContainerBudget("novel-brain-capacity", [
      container("api", 2, 3 * 1024 ** 3),
      container("postgres", 1, 1 * 1024 ** 3),
      container("redis", 1, 1024 ** 3),
      container("minio", 1, 1 * 1024 ** 3),
      container("worker", 2, 5 * 1024 ** 3),
    ]);

    expect(budget.matchesApprovedBudget).toBe(false);
  });
});

describe("isCertificationEligible", () => {
  it("requires the exact host and the enforced container budget", () => {
    expect(
      isCertificationEligible({
        cpuMatches: true,
        memoryMatches: true,
        diskTotalAtLeastApproved: true,
        containerBudgetMatches: false,
      }),
    ).toBe(false);
    expect(
      isCertificationEligible({
        cpuMatches: true,
        memoryMatches: true,
        diskTotalAtLeastApproved: true,
        containerBudgetMatches: true,
      }),
    ).toBe(true);
  });
});

function container(
  service: string,
  cpuCores: number | null,
  memoryBytes: number | null,
): DockerContainerLimit {
  return {
    name: `novel-brain-capacity-${service}-1`,
    service,
    nanoCpus: cpuCores === null ? null : cpuCores * 1e9,
    memoryBytes,
  };
}
