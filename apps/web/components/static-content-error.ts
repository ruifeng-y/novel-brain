"use client";

import { CircleAlert, RotateCcw } from "lucide-react";
import { createElement } from "react";

export function StaticContentError({ retry }: { retry: () => void }) {
  return createElement(
    "div",
    { className: "static-content-error", role: "alert" },
    createElement(CircleAlert, { "aria-hidden": true, size: 26 }),
    createElement("h1", null, "内容暂时不可用"),
    createElement("p", null, "帮助或条款内容没有成功加载，请稍后重试。"),
    createElement(
      "button",
      { className: "btn btn-primary", onClick: retry, type: "button" },
      createElement(RotateCcw, { "aria-hidden": true, size: 17 }),
      createElement("span", null, "重新加载"),
    ),
  );
}
