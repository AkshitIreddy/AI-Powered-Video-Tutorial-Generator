import { appBootstrap, type BootstrapInfo } from "./native";

/** Follow deferred native initialization until the worker reaches a stable state. */
export function watchRuntimeBootstrap(
  onUpdate: (bootstrap: BootstrapInfo) => void,
  onError: (error: unknown) => void,
  read: () => Promise<BootstrapInfo> = appBootstrap,
): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const poll = async () => {
    try {
      const bootstrap = await read();
      if (!active) return;
      onUpdate(bootstrap);
      if (bootstrap.worker.state === "starting") {
        if (++attempts >= 90) {
          onError(new Error("The worker is taking longer than expected to start. Check Settings & diagnostics before starting a tutorial."));
          return;
        }
        timer = setTimeout(() => { void poll(); }, 2000);
      }
    } catch (error) { if (active) onError(error); }
  };
  void poll();
  return () => { active = false; if (timer !== undefined) clearTimeout(timer); };
}
