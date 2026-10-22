import { describe, expect, it } from "vitest";
import { isDue, JobRunner, type LastRunStore } from "./scheduler";

function memStore(initial: Record<string, string> = {}): LastRunStore & { data: Map<string, Date> } {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, new Date(v)]));
  return { data, get: async (j) => data.get(j) ?? null, set: async (j, at) => void data.set(j, at) };
}

describe("isDue", () => {
  it("is due when never run or old enough", () => {
    const now = new Date("2026-10-23T10:00:00Z");
    expect(isDue(null, now, 20)).toBe(true);
    expect(isDue(new Date("2026-10-22T13:00:00Z"), now, 20)).toBe(true); // 21h
    expect(isDue(new Date("2026-10-22T15:00:00Z"), now, 20)).toBe(false); // 19h
  });
});

describe("JobRunner", () => {
  const setup = (initial: Record<string, string>, nowIso: string) => {
    const calls: string[] = [];
    let now = new Date(nowIso);
    const store = memStore(initial);
    const jobs = ["flights", "hotels", "tickets"].map((name) => ({ name, run: async () => void calls.push(name) }));
    const runner = new JobRunner(jobs, store, { now: () => now, log: () => {} });
    return { calls, store, runner, setNow: (iso: string) => (now = new Date(iso)) };
  };

  it("catches up only stale jobs, in order, on startup", async () => {
    const { calls, runner } = setup({ flights: "2026-10-21T09:10:00Z", hotels: "2026-10-23T02:00:00Z" }, "2026-10-23T03:00:00Z");
    expect(await runner.catchUp("startup")).toEqual(["flights", "tickets"]);
    expect(calls).toEqual(["flights", "tickets"]);
  });

  it("skips the 5 AM run right after a catch-up, but runs it the next day", async () => {
    const { calls, runner, setNow } = setup({}, "2026-10-23T07:00:00Z"); // PC woke at 3 AM ET
    await runner.catchUp();
    calls.length = 0;
    setNow("2026-10-23T09:10:00Z"); // 5:10 AM ET, 2h later
    expect(await runner.scheduled("flights")).toBe(false);
    setNow("2026-10-24T09:10:00Z");
    expect(await runner.scheduled("flights")).toBe(true);
    expect(calls).toEqual(["flights"]);
  });

  it("never runs the same job twice at once, and retries after a failure", async () => {
    const store = memStore();
    let release!: () => void;
    let n = 0;
    const runner = new JobRunner(
      [{ name: "slow", run: () => (++n === 1 ? new Promise<void>((r) => (release = r)) : Promise.reject(new Error("boom"))) }],
      store,
      { log: () => {} },
    );
    const first = runner.runIfDue("slow", 0, "a");
    expect(await runner.runIfDue("slow", 0, "b")).toBe(false); // already running
    release();
    expect(await first).toBe(true);
    expect(await runner.runIfDue("slow", 0, "c")).toBe(false); // failed → not marked as run
    expect(store.data.has("slow")).toBe(true); // still the first success
  });
});
