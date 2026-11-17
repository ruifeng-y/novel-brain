import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { scanLegalCopy, scanLegalCopyText } from "../legal-copy-guardrails.mjs";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const legalCopyPath = path.join(webRoot, "content/legal-copy.json");
const publicClaimRoots = [
  path.join(webRoot, "app/help"),
  path.join(webRoot, "app/legal"),
  path.join(webRoot, "content"),
];
const publicClaimFiles = [
  path.join(webRoot, "components/help-center.tsx"),
  path.join(webRoot, "components/legal-content.tsx"),
  path.join(webRoot, "components/export-publish-workspace.tsx"),
];

describe("legal copy guardrails", () => {
  it("accepts the current reviewed-by-owner-pending copy", async () => {
    const copy = JSON.parse(await readFile(legalCopyPath, "utf8"));
    expect(copy.status).toBe("owner-approved-draft");
    expect(scanLegalCopy(copy)).toEqual([]);
    const sourceFiles = [...publicClaimFiles];
    for (const root of publicClaimRoots) {
      for (const entry of await readdir(root, { recursive: true })) {
        if (/\.(?:json|ts|tsx)$/u.test(entry)) {
          sourceFiles.push(path.join(root, entry));
        }
      }
    }
    for (const sourcePath of sourceFiles) {
      const source = await readFile(sourcePath, "utf8");
      expect(scanLegalCopyText(source, sourcePath)).toEqual([]);
    }
  });

  it("rejects unsupported privacy, training and security claims", () => {
    const findings = scanLegalCopy({
      status: "owner-approved-draft",
      documents: {
        privacy: {
          sections: [
            {
              title: "数据承诺",
              paragraphs: [
                "平台保证 100% 安全，使用银行级加密。",
                "作者数据绝不用于训练，我们从不保留任何数据。",
                "我们不会收集任何用户数据，数据也不会泄露。",
              ],
            },
          ],
        },
      },
    });

    expect(findings.map((finding) => finding.term)).toEqual(
      expect.arrayContaining([
        "100% 安全",
        "银行级",
        "绝不用于训练",
        "从不保留",
        "不会收集任何数据",
        "不会泄露",
      ]),
    );
  });
});
