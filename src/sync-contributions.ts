import { createGitHubClient, getPullRequests } from "./github.js";
import { HabboPublicAPI, UserTargetKind } from "wired-api-wrapper-node";
import type { Config } from "./sync-opened-prs.js";

export async function syncContributions(config: Config, github = createGitHubClient(config.githubToken)) {
  const authors = new Map<string, { login: string; count: number }>();
  // Finish all GitHub reads before changing any contribution values.
  for (const pr of await getPullRequests(github)) {
    if (!pr.user) continue; // Deleted accounts cannot be resolved by username.
    const author = authors.get(String(pr.user.id)) ?? { login: pr.user.login, count: 0 };
    author.count++;
    authors.set(String(pr.user.id), author);
  }
  for (const [id, author] of authors) {
    const { data } = await github.rest.users.getByUsername({ username: author.login });
    if (String(data.id) !== id) {
      throw new Error(`GitHub identity changed for ${author.login}; contributions were not updated.`);
    }
  }

  const users = HabboPublicAPI.fromHotel(config.hotel)
    .variables(config.roomId, config.readKey, config.writeKey).user();
  const holders = new Map<number, bigint>();
  for (let page = 1; ; page++) {
    const result = await users.listHolders("github_id", UserTargetKind.Users, undefined, undefined, page, 50);
    for (const holder of result.items) {
      if (!holder.user) throw new Error("Habbo returned a github_id holder without a user.");
      if (holders.has(holder.user.id)) {
        throw new Error("Habbo returned duplicate holders; contributions were not updated.");
      }
      holders.set(holder.user.id, holder.variable.value);
    }
    if (result.items.length < 50) break;
  }

  const matched = new Set<string>();
  const updated: { habboId: number; githubId: string; contributions: number }[] = [];
  for (const [habboId, githubId] of holders) {
    if (githubId <= 0n) continue;
    const author = authors.get(githubId.toString());
    // Set zero for linked users with no authored PRs to clear stale counts.
    const count = author?.count ?? 0;
    try {
      const result = await users.giveVariable("contributions", UserTargetKind.Users, habboId, BigInt(count));
      if (result.value !== BigInt(count)) throw new Error("Unexpected contribution value.");
    } catch {
      throw new Error(`Could not confirm contributions for Habbo user ${habboId}. ${updated.length} earlier user updates succeeded; rerunning will assign the totals again.`);
    }
    if (author) matched.add(githubId.toString());
    updated.push({ habboId, githubId: githubId.toString(), contributions: count });
  }
  const skipped = [...authors].filter(([id]) => !matched.has(id)).map(([, author]) => author.login);
  return { updated, skipped };
}
