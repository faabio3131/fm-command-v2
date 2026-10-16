"use client";

import { RouteError } from "../route-states";

export default function SettingsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="settings" reset={reset} compact />;
}
