"use client";

import { RouteError } from "../route-states";

export default function AgentsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="agents" reset={reset} compact />;
}
