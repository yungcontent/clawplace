"use client";

import { Analytics } from "@vercel/analytics/next";

export function AnalyticsWrapper() {
  return (
    <Analytics
      beforeSend={(event) => {
        if (typeof window !== "undefined" && localStorage.getItem("exclude-analytics") === "true") {
          return null;
        }
        return event;
      }}
    />
  );
}
