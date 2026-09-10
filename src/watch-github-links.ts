import { setTimeout as delay } from "node:timers/promises";
import { createGitHubClient, GitHubRateLimitError } from "./github.js";
import { readConfig } from "./sync-opened-prs.js";
import { syncGitHubUsernames } from "./sync-github-usernames.js";

const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`);
const logError = (message: string) => console.error(`[${new Date().toISOString()}] ${message}`);

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

try {
  const config = readConfig(process.env);
  const interval = Number(process.env.GITHUB_LINK_POLL_SECONDS ?? "15");
  if (!Number.isFinite(interval) || interval < 5 || interval > 3600) {
    throw new Error("GITHUB_LINK_POLL_SECONDS must be between 5 and 3600.");
  }
  const github = createGitHubClient(config.githubToken);
  let failures = 0;
  log(`Watching linked_gh=1 every ${interval} seconds. Press Ctrl+C to stop.`);
  while (!stop.signal.aborted) {
    let waitMs = interval * 1000;
    try {
      log("Polling for linked_gh=1 requests.");
      const startedAt = Date.now();
      const updated = await syncGitHubUsernames(config, github, log);
      log(`Poll complete: ${updated.length} users linked in ${Date.now() - startedAt} ms.`);
      failures = 0;
    } catch (error) {
      failures++;
      waitMs = Math.max(waitMs, Math.min(300_000, 30_000 * 2 ** Math.min(failures - 1, 4)));
      if (error instanceof GitHubRateLimitError) waitMs = Math.max(waitMs, 60_000, error.retryAt - Date.now() + 1000);
      logError(error instanceof Error ? error.message : "Link lookup failed.");
      log(`Pending requests will be retried in ${Math.ceil(waitMs / 1000)} seconds.`);
    }
    // Sleep in bounded chunks so shutdown remains responsive even at quota reset.
    const resumeAt = Date.now() + waitMs;
    if (!stop.signal.aborted) log(`Next poll at ${new Date(resumeAt).toISOString()}.`);
    while (!stop.signal.aborted && Date.now() < resumeAt) {
      await delay(Math.min(60_000, resumeAt - Date.now()), undefined, { signal: stop.signal });
    }
  }
} catch (error) {
  if (!stop.signal.aborted) {
    logError(error instanceof Error ? error.message : "Link watcher failed.");
    process.exitCode = 1;
  }
}

if (stop.signal.aborted) log("Link watcher stopped.");
