import { afterEach, describe, expect, it, vi } from "vitest";
import { watchRuntimeBootstrap } from "../runtimeBootstrap";
import type { BootstrapInfo } from "../native";

const starting = { worker: { state: "starting" } } as BootstrapInfo;
const ready = { worker: { state: "ready", pid: 42, endpoint: "local" } } as BootstrapInfo;
afterEach(() => { vi.useRealTimers(); });

describe("deferred native startup", () => {
  it("updates Starting to Ready and stops polling", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce(starting).mockResolvedValue(ready);
    const update = vi.fn();
    const error = vi.fn();
    const stop = watchRuntimeBootstrap(update, error, read);
    await vi.advanceTimersByTimeAsync(2100);
    expect(update.mock.calls.map(([value]) => value.worker.state)).toEqual(["starting", "ready"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
    stop();
  });
  it("ignores an in-flight response after unmount", async () => {
    let resolve!: (value: BootstrapInfo) => void;
    const update = vi.fn();
    const stop = watchRuntimeBootstrap(update, vi.fn(), () => new Promise((done) => { resolve = done; }));
    stop();
    resolve(ready);
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
  });
  it("reports an actionable timeout instead of polling indefinitely", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue(starting);
    const error = vi.fn();
    const stop = watchRuntimeBootstrap(vi.fn(), error, read);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(read).toHaveBeenCalledTimes(90);
    expect(error).toHaveBeenCalledOnce();
    stop();
  });
});
