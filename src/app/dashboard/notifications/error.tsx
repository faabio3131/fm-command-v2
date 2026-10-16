"use client";

import { RouteError } from "../route-states";

export default function NotificationsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="notifications" reset={reset} />;
}
