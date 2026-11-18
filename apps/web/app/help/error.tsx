"use client";

import { StaticContentError } from "../../components/static-content-error";

export default function HelpError({ retry }: { error: unknown; retry: () => void }) {
  return <StaticContentError retry={retry} />;
}
