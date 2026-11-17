import { notFound } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { LegalDocumentContent } from "../../../components/legal-content";
import { isLegalDocumentKey, legalDocumentOrder } from "../../../lib/legal-content";

export function generateStaticParams() {
  return legalDocumentOrder.map((document) => ({ document }));
}

export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ document: string }>;
}) {
  const { document } = await params;
  if (!isLegalDocumentKey(document)) {
    notFound();
  }
  return (
    <AppShell>
      <LegalDocumentContent documentKey={document} />
    </AppShell>
  );
}
