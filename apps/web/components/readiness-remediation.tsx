"use client";

import { Check, Circle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { GenerationReadiness } from "@novel-brain/contracts";

export function ReadinessRemediation({
  readiness,
  readyText = "所有准备项已就绪。",
}: {
  readiness: GenerationReadiness;
  readyText?: string;
}) {
  const unresolved = readiness.items.filter((item) => !item.ready);
  if (unresolved.length === 0) {
    return (
      <div className="readiness-remediation-clear">
        <Check size={14} aria-hidden="true" />
        {readyText}
      </div>
    );
  }

  return (
    <div className="readiness-remediation-list" role="list" aria-label="准备度修复项">
      {unresolved.map((item) => (
        <article
          className={`readiness-remediation-item severity-${item.severity}`}
          data-readiness-key={item.key}
          key={item.key}
          role="listitem"
        >
          <span>
            {item.severity === "blocker" ? (
              <TriangleAlert size={14} aria-hidden="true" />
            ) : (
              <Circle size={10} aria-hidden="true" />
            )}
          </span>
          <div>
            <strong>
              {item.label}
              <small className={`readiness-severity readiness-severity-${item.severity}`}>
                {item.severity === "blocker" ? "阻断" : "提醒"}
              </small>
            </strong>
            <small>{item.reason}</small>
            {item.evidence.length > 1 &&
            item.evidence.some((entry) => entry.summary !== item.reason) ? (
              <small>{item.evidence.map((entry) => entry.summary).join("；")}</small>
            ) : null}
          </div>
          {item.remediation ? (
            <Link
              className="text-btn small readiness-remediation-link"
              href={item.remediation.href}
            >
              {item.remediation.label}
            </Link>
          ) : null}
        </article>
      ))}
    </div>
  );
}
