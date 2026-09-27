"use client";

import { useEffect } from "react";

/**
 * The workspace uses no service workers. One left on this address by another local app
 * (e.g. a web app that ran on the same port before) could serve that app's files here,
 * so remove any registration and reload once.
 */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then(async (regs) => {
        if (!regs.length) return;
        await Promise.all(regs.map((r) => r.unregister()));
        window.location.reload();
      })
      .catch(() => undefined);
  }, []);
  return null;
}
