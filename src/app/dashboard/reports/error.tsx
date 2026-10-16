"use client";

import { RouteError } from "../route-states";

export default function ReportsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="reports" reset={reset} compact />;
}
