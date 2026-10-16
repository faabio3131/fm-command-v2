"use client";

import { RouteError } from "../route-states";

export default function SearchError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="search" reset={reset} />;
}
