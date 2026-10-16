"use client";

import { RouteError } from "../route-states";

export default function ActivityError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="activity" reset={reset} />;
}
