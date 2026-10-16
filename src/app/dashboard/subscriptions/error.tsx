"use client";

import { RouteError } from "../route-states";

export default function SubscriptionsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="subscriptions" reset={reset} compact />;
}
