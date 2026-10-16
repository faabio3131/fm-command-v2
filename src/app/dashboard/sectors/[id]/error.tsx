"use client";

import { RouteError } from "../../route-states";

export default function SectorsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="sectors" reset={reset} compact />;
}
