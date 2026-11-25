export function computeReviewStatus({ structuralBlockers, qualityBlockers }) {
  const normalizedStructuralBlockers = [...new Set(structuralBlockers)].sort();
  const normalizedQualityBlockers = [...new Set(qualityBlockers)].sort();
  const gateBlockers = [
    ...new Set([...normalizedStructuralBlockers, ...normalizedQualityBlockers]),
  ].sort();

  return {
    status:
      normalizedStructuralBlockers.length > 0
        ? "blocked"
        : gateBlockers.length > 0
          ? "complete-with-warnings"
          : "complete",
    technicalStatus: normalizedStructuralBlockers.length === 0 ? "passed" : "blocked",
    humanReviewCompleted: normalizedStructuralBlockers.length === 0,
    qualityGate: {
      status: gateBlockers.length === 0 ? "pass" : "blocked",
      blockers: gateBlockers,
    },
    gateBlockers,
  };
}

export function computeCheckExitCode({ technicalStatus, staleFiles, checkFilesOnly }) {
  return staleFiles.length > 0 || (!checkFilesOnly && technicalStatus !== "passed") ? 1 : 0;
}
