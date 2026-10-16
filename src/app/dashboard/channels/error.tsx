"use client";

import { RouteError } from "../route-states";

export default function ChannelsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError screen="channels" reset={reset} compact />;
}
