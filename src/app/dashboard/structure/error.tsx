"use client";

import { RouteError } from "../route-states";

export default function StructureError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="structure" reset={reset} compact />;
}
