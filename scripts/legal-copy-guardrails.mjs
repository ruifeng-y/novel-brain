const UNSUPPORTED_CLAIMS = [
  ["100% 安全", /100\s*%\s*安全/iu],
  ["绝对安全", /绝对安全/iu],
  ["完全安全", /完全安全/iu],
  ["银行级", /银行级/iu],
  ["零风险", /零风险/iu],
  ["端到端加密", /端到端加密/iu],
  ["永不泄露", /永不(?:泄露|泄漏)/iu],
  ["绝不泄露", /绝不(?:泄露|泄漏)/iu],
  ["不收集任何数据", /不收集任何数据/iu],
  ["不会收集任何数据", /不会(?:收集|保存|记录).{0,12}(?:任何|全部).{0,8}(?:数据|信息)/iu],
  [
    "不会泄露",
    /(?:数据|信息|正文|作品).{0,8}不会(?:泄露|泄漏)|不会(?:泄露|泄漏).{0,8}(?:数据|信息|正文|作品)/iu,
  ],
  ["从不保留", /从不保留/iu],
  ["绝不用于训练", /绝不用于训练/iu],
  ["完全合规", /完全合规/iu],
  ["保证通过审核", /保证通过审核/iu],
  ["保证不侵权", /保证不侵权/iu],
];

function collectStrings(value, path = "$", output = []) {
  if (typeof value === "string") {
    output.push({ path, text: value });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStrings(entry, `${path}[${index}]`, output));
    return output;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectStrings(entry, `${path}.${key}`, output);
    }
  }
  return output;
}

export function scanLegalCopy(copy) {
  return scanLegalCopyFields(copy);
}

export function scanLegalCopyText(text, path = "$") {
  const findings = [];
  for (const [term, pattern] of UNSUPPORTED_CLAIMS) {
    if (pattern.test(text)) {
      findings.push({ path, term, text });
    }
  }
  return findings;
}

export function scanLegalCopyFields(copy) {
  const findings = [];
  for (const { path, text } of collectStrings(copy)) {
    for (const [term, pattern] of UNSUPPORTED_CLAIMS) {
      if (pattern.test(text)) {
        findings.push({ path, term, text });
      }
    }
  }
  return findings;
}
