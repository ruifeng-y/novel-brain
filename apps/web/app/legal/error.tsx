"use client";

import { StaticContentError } from "../../components/static-content-error";

export default function LegalError({ reset }: { error: unknown; reset: () => void }) {
  return <StaticContentError retry={reset} />;
}
