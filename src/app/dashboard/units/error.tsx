"use client";

import { RouteError } from "../route-states";

export default function UnitsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="units" reset={reset} compact />;
}
