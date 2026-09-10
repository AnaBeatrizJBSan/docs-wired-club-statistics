import { Octokit } from "octokit";

export class GitHubRateLimitError extends Error {
  constructor(message: string, public readonly retryAt = 0) { super(message); }
}

export function createGitHubClient(token?: string, fetcher?: typeof fetch) {
  const github = new Octokit({
    ...(token ? { auth: token } : {}),
    request: { timeout: 30_000, ...(fetcher ? { fetch: fetcher } : {}) },
    retry: { enabled: false },
    throttle: {
      onRateLimit: () => false,
      onSecondaryRateLimit: () => false,
    },
  });
  github.hook.error("request", async (error) => {
    const response = (error as { status?: number; response?: { headers?: Record<string, string | number | undefined> } });
    const headers = response.response?.headers ?? {};
    const limited = response.status === 429 || (response.status === 403 && (
      String(headers["x-ratelimit-remaining"]) === "0" || headers["retry-after"] !== undefined
      || /rate limit|quota exhausted/i.test(error.message)
    ));
    if (!limited) throw error;
    const reset = Number(headers["x-ratelimit-reset"]);
    const retryAfter = Number(headers["retry-after"]);
    let retryAt = 0;
    if (Number.isFinite(reset) && reset > 0) retryAt = reset * 1000;
    if (Number.isFinite(retryAfter) && retryAfter >= 0) retryAt = Math.max(retryAt, Date.now() + retryAfter * 1000);
    const date = new Date(retryAt);
    const wait = retryAt > 0 && !Number.isNaN(date.getTime())
      ? ` Retry after ${date.toISOString()}.`
      : " Wait at least one minute before retrying; increase the wait if it persists.";
    throw new GitHubRateLimitError(`GitHub API rate limit reached.${wait} No automatic retry was scheduled.${token ? " Your authenticated quota is exhausted." : " Set GITHUB_TOKEN in .env to use an authenticated quota."}`, retryAt);
  });
  return github;
}

// A client belongs to one sync run. Share the complete list across its statistics.
const pullRequests = new WeakMap<Octokit, ReturnType<typeof fetchPullRequests>>();
async function fetchPullRequests(github: Octokit) {
  return github.paginate(github.rest.pulls.list, {
    owner: "WiredClub", repo: "docs", state: "all", per_page: 100,
  });
}
export function getPullRequests(github: Octokit) {
  let result = pullRequests.get(github);
  if (!result) {
    result = fetchPullRequests(github);
    pullRequests.set(github, result);
    void result.catch(() => pullRequests.delete(github));
  }
  return result;
}
