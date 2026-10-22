// Runs each job at its scheduled time, and catches up on missed runs (PC off or asleep at 5 AM).
// One run at a time per job; last-run times live in the settings table so restarts remember them.
import type { Prisma, PrismaClient } from "@rave-run/db";

export interface LastRunStore {
  get(job: string): Promise<Date | null>;
  set(job: string, at: Date): Promise<void>;
}

export function settingsLastRunStore(prisma: PrismaClient): LastRunStore {
  const key = (job: string) => `job:${job}:lastRunAt`;
  return {
    async get(job) {
      const row = await prisma.setting.findUnique({ where: { key: key(job) } });
      const v = row?.value;
      return typeof v === "string" ? new Date(v) : null;
    },
    async set(job, at) {
      const value = at.toISOString() as Prisma.InputJsonValue;
      await prisma.setting.upsert({ where: { key: key(job) }, create: { key: key(job), value }, update: { value } });
    },
  };
}

/** True when the job has never run or last ran at least `minHours` ago. */
export function isDue(lastRun: Date | null, now: Date, minHours: number): boolean {
  return !lastRun || now.getTime() - lastRun.getTime() >= minHours * 3_600_000;
}

export interface Job {
  name: string;
  run: () => Promise<void>;
}

export interface RunnerOptions {
  /** A scheduled (cron) run is skipped if the job ran this recently, e.g. after a catch-up. */
  scheduledMinHours?: number;
  /** A catch-up run happens when the last run is at least this old. */
  catchUpAfterHours?: number;
  now?: () => Date;
  log?: (msg: string) => void;
}

export class JobRunner {
  private running = new Set<string>();
  private readonly scheduledMinHours: number;
  private readonly catchUpAfterHours: number;
  private readonly now: () => Date;
  private readonly log: (msg: string) => void;

  constructor(
    private jobs: Job[],
    private store: LastRunStore,
    opts: RunnerOptions = {},
  ) {
    this.scheduledMinHours = opts.scheduledMinHours ?? 6;
    this.catchUpAfterHours = opts.catchUpAfterHours ?? 20;
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? console.log;
  }

  /** Run one job unless it's already running or ran within `minHours` (0 = always). Returns whether it ran. */
  async runIfDue(name: string, minHours: number, why: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job || this.running.has(name)) return false;
    const last = await this.store.get(name);
    if (!isDue(last, this.now(), minHours)) return false;
    this.running.add(name);
    try {
      this.log(`Job ${name}: starting (${why}${last ? `, last run ${last.toISOString()}` : ", first run"})`);
      await job.run();
      await this.store.set(name, this.now());
      return true;
    } catch (e) {
      // The job functions log and record their own failures; don't mark it as run so it's retried.
      this.log(`Job ${name}: failed: ${(e as Error).message}`);
      return false;
    } finally {
      this.running.delete(name);
    }
  }

  /** The scheduled (cron) run for a job. */
  scheduled(name: string): Promise<boolean> {
    return this.runIfDue(name, this.scheduledMinHours, "scheduled");
  }

  /** Run every job whose last run is old enough, one after another (order matters: flights → hotels → tickets). */
  async catchUp(why = "catch-up"): Promise<string[]> {
    const ran: string[] = [];
    for (const j of this.jobs) if (await this.runIfDue(j.name, this.catchUpAfterHours, why)) ran.push(j.name);
    return ran;
  }

  /** Run everything now regardless of timing (manual `--once`). */
  async runAll(): Promise<void> {
    for (const j of this.jobs) await this.runIfDue(j.name, 0, "manual");
  }
}
