"use client";

import { RouteError } from "../route-states";

export default function TrialsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="trials" reset={reset} compact />;
}
