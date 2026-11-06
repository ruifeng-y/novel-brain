import { MapPin, Sparkles } from "lucide-react";
import type { StyleDriftFinding, StyleDriftReport } from "@novel-brain/contracts";

const findingLabels: Record<StyleDriftFinding["code"], string> = {
  CHARACTER_VOICE_DRIFT: "人物声线偏离",
  WORK_STYLE_DRIFT: "作品文风偏离",
  INTENTIONAL_CHARACTER_DEVELOPMENT: "有依据的成长变化",
};

export function StyleDriftFindings({
  report,
  onLocate,
}: {
  report: StyleDriftReport;
  onLocate?: (finding: StyleDriftFinding) => void;
}) {
  return (
    <div className="style-drift-report" data-style-drift-report={report.scope}>
      <p className="style-drift-summary">{report.summary}</p>
      <div className="style-drift-provenance">
        <span>基线版本 {report.profileVersion}</span>
        <span>{report.model.model}</span>
        <span>检查规则 v{report.prompt.version}</span>
        <span>
          第 {report.window.fromChapter}
          {report.window.toChapter === report.window.fromChapter
            ? ""
            : `–${report.window.toChapter}`}{" "}
          章
        </span>
      </div>
      {report.findings.length === 0 ? (
        <p className="style-drift-empty">本区间没有发现偏离已批准样本的段落。</p>
      ) : (
        <div className="style-drift-finding-list">
          {report.findings.map((finding) => (
            <article
              className={`style-drift-finding ${finding.classification}`}
              data-style-finding={finding.code}
              data-style-classification={finding.classification}
              key={finding.id}
            >
              <div className="style-drift-finding-head">
                <span className={`badge style-drift-${finding.classification}`}>
                  {findingLabels[finding.code]}
                </span>
                <small>{finding.locator}</small>
              </div>
              <blockquote>“{finding.quote}”</blockquote>
              <p>{finding.explanation}</p>
              {finding.growthEvidence ? (
                <div className="style-drift-growth">
                  <strong>成长依据</strong>
                  <span>
                    {finding.growthEvidence.startState} → {finding.growthEvidence.endState}
                  </span>
                  <small>{finding.growthEvidence.reason}</small>
                </div>
              ) : null}
              <div className="style-drift-action-row">
                <span>{finding.recommendation}</span>
                {onLocate ? (
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={() => onLocate(finding)}
                    type="button"
                  >
                    <MapPin size={13} aria-hidden="true" />
                    定位证据
                  </button>
                ) : (
                  <span className="style-drift-locate-hint">
                    <Sparkles size={12} aria-hidden="true" />
                    可在写作台定位原文
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
