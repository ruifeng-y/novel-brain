import legalCopyJson from "../content/legal-copy.json";

export type LegalDocumentKey = "terms" | "privacy" | "ai-disclosure";

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export interface LegalDocument {
  title: string;
  summary: string;
  sections: LegalSection[];
}

export const legalCopy = legalCopyJson as {
  version: string;
  status: "owner-review-required";
  lastUpdated: string;
  documents: Record<LegalDocumentKey, LegalDocument>;
};

export const legalDocumentOrder: LegalDocumentKey[] = ["terms", "privacy", "ai-disclosure"];

export function isLegalDocumentKey(value: string): value is LegalDocumentKey {
  return legalDocumentOrder.includes(value as LegalDocumentKey);
}
