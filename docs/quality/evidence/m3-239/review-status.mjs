export function computeReviewStatus({ structuralBlockers, qualityBlockers }) {
  const normalizedStructuralBlockers = [...new Set(structuralBlockers)].sort();
  const normalizedQualityBlockers = [...new Set(qualityBlockers)].sort();
  const gateBlockers = [
    ...new Set([...normalizedStructuralBlockers, ...normalizedQualityBlockers]),
  ].sort();

  return {
    technicalStatus: normalizedStructuralBlockers.length === 0 ? "passed" : "blocked",
    humanReviewCompleted: gateBlockers.length === 0,
    qualityGate: {
      status: gateBlockers.length === 0 ? "pass" : "blocked",
      blockers: gateBlockers,
    },
    gateBlockers,
  };
}
