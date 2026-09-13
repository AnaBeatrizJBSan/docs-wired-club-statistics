import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { open } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const pm2Home = resolve(projectRoot, ".pm2");
const pm2Bin = resolve(projectRoot, "node_modules/pm2/bin/pm2");

export function redact(text: string) {
  for (const [key, value] of Object.entries(process.env)) {
    if (/TOKEN|KEY|SECRET|PASSWORD/i.test(key) && value) text = text.split(value).join("[redacted]");
  }
  return text.replace(/(Bearer|token)\s+[A-Za-z0-9_|.-]+/gi, "$1 [redacted]");
}

async function pm2(args: string[]) {
  const { stdout } = await exec(process.execPath, [pm2Bin, ...args], {
    cwd: projectRoot,
    env: { ...process.env, PM2_HOME: pm2Home },
    timeout: 20_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

async function tail(path?: string) {
  if (!path) return "";
  // PM2 stores stdout/stderr under this project's log directory.
  const safePath = resolve(pm2Home, "logs", basename(path));
  let file;
  try {
    file = await open(safePath, "r");
    const { size } = await file.stat();
    const buffer = Buffer.alloc(Math.min(size, 32_768));
    await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    return redact(buffer.toString("utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  } finally { await file?.close(); }
}

type PM2Process = { name?: string; pm2_env?: {
  status?: string; restart_time?: number; pm_uptime?: number;
  pm_out_log_path?: string; pm_err_log_path?: string;
} };

export class DashboardManager {
  constructor(
    private runPM2: (args: string[]) => Promise<string> = pm2,
    private startSync: () => ChildProcess = () => spawn("yarn", ["sync"], { cwd: projectRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] }),
  ) {}
  private child: ChildProcess | undefined;
  private busy = false;
  private sync = { status: "idle", startedAt: null as string | null, finishedAt: null as string | null, exitCode: null as number | null, logs: "" };
  private watcherCache: { at: number; data: Awaited<ReturnType<DashboardManager["readWatcher"]>> } | undefined;
  private watcherRequest: Promise<Awaited<ReturnType<DashboardManager["readWatcher"]>>> | undefined;

  private async readWatcher() {
    const output = await this.runPM2(["jlist", "--silent"]);
    // First launch may prepend PM2 daemon initialization messages.
    const start = output.indexOf('[{"');
    const processes = JSON.parse(start >= 0 ? output.slice(start) : output.trim().endsWith("[]") ? "[]" : output) as PM2Process[];
    const processInfo = processes.find(item => item.name === "wired-club-links")?.pm2_env;
    const [logs, errors] = await Promise.all([tail(processInfo?.pm_out_log_path), tail(processInfo?.pm_err_log_path)]);
    return {
      status: processInfo?.status ?? "not started", restarts: processInfo?.restart_time ?? 0,
      startedAt: processInfo?.pm_uptime ? new Date(processInfo.pm_uptime).toISOString() : null,
      logs, errors,
    };
  }

  private async watcher(fresh = false) {
    if (!fresh && this.watcherCache && Date.now() - this.watcherCache.at < 2000) return this.watcherCache.data;
    if (!this.watcherRequest) {
      this.watcherRequest = this.readWatcher().then(data => {
        this.watcherCache = { at: Date.now(), data }; return data;
      }).finally(() => { this.watcherRequest = undefined; });
    }
    return this.watcherRequest;
  }

  async state() {
    return { sync: this.sync, watcher: await this.watcher(), busy: this.busy,
      repository: "WiredClub/docs", hotel: process.env.HABBO_HOTEL ?? "Not configured",
      room: process.env.HABBO_ROOM_ID ?? "Not configured",
      configured: ["HABBO_HOTEL", "HABBO_ROOM_ID", "HABBO_WIRED_READ_KEY", "HABBO_WIRED_WRITE_KEY"].every(key => Boolean(process.env[key]?.trim())),
      authenticated: Boolean(process.env.GITHUB_TOKEN?.trim()),
    };
  }

  async action(action: string) {
    if (!["sync", "watcher-start", "watcher-stop", "watcher-restart"].includes(action)) throw new Error("Unknown action.");
    if (this.busy) throw new Error("Another action is in progress. Try again shortly.");
    this.busy = true;
    try {
      const watcher = await this.watcher(true);
      if (action === "sync") {
        if (this.child) throw new Error("A sync is already running.");
        if (!["stopped", "errored", "not started"].includes(watcher.status)) throw new Error("Stop the link watcher before running a sync.");
        this.sync = { status: "running", startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, logs: "" };
        const child = this.startSync();
        this.child = child;
        const append = (chunk: Buffer | string) => { this.sync.logs = (this.sync.logs + redact(String(chunk))).slice(-65_536); };
        child.stdout?.on("data", append);
        child.stderr?.on("data", append);
        child.once("error", error => append(`Could not start sync: ${error.message}\n`));
        child.once("close", code => {
          this.sync.status = code === 0 ? "succeeded" : "failed";
          this.sync.exitCode = code;
          this.sync.finishedAt = new Date().toISOString();
          this.child = undefined;
        });
      } else {
        if (this.child) throw new Error("Wait for the current sync to finish before changing the watcher.");
        if (action === "watcher-start") {
          if (watcher.status === "online") throw new Error("The watcher is already running.");
          await this.runPM2(["start", "ecosystem.config.cjs", "--only", "wired-club-links"]);
        } else if (action === "watcher-stop") {
          if (watcher.status !== "not started") await this.runPM2(["stop", "wired-club-links"]);
        } else {
          if (watcher.status === "not started") throw new Error("Start the watcher before restarting it.");
          await this.runPM2(["restart", "wired-club-links", "--update-env"]);
        }
      }
    } finally { this.busy = false; this.watcherCache = undefined; }
  }
}
