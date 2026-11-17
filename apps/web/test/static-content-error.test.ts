import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StaticContentError } from "../components/static-content-error";

describe("static content error state", () => {
  it("renders a retry action", () => {
    const html = renderToStaticMarkup(
      createElement(StaticContentError, { retry: () => undefined }),
    );

    expect(html).toContain("内容暂时不可用");
    expect(html).toContain("重新加载");
    expect(html).toContain("帮助或条款内容没有成功加载");
  });
});
