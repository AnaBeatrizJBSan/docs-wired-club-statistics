import { createGitHubClient } from "./github.js";
import { HabboPublicAPI, UserTargetKind } from "wired-api-wrapper-node";
import type { Config } from "./sync-opened-prs.js";

export async function syncCommits(config: Config, github = createGitHubClient(config.githubToken)) {
  const authors = new Map<string, { login: string; count: number }>();
  // Fetch all pages before writing; a partial fetch must never lower a user's count.
  const seenCommits = new Set<string>();
  for await (const page of github.paginate.iterator(github.rest.repos.listCommits, {
    owner: "WiredClub", repo: "docs", per_page: 100,
  })) {
    for (const commit of page.data) {
      if (seenCommits.has(commit.sha)) continue;
      seenCommits.add(commit.sha);
      // Match the GitHub author identity, not the committer or free-text Git name.
      if (!commit.author) continue;
      const id = String(commit.author.id);
      const author = authors.get(id) ?? { login: commit.author.login, count: 0 };
      author.count++;
      authors.set(id, author);
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
        throw new Error("Habbo returned duplicate holders; commits were not updated.");
      }
      holders.set(holder.user.id, holder.variable.value);
    }
    if (result.items.length < 50) break;
  }

  const matched = new Set<string>();
  const updated: { habboId: number; githubId: string; commits: number }[] = [];
  for (const [habboId, githubId] of holders) {
    if (githubId <= 0n) continue;
    const author = authors.get(githubId.toString());
    // Set zero for linked users with no authored commits to clear stale counts.
    let count = author?.count ?? 0;
    if (author) matched.add(githubId.toString());
    try {
      const result = await users.giveVariable("commits", UserTargetKind.Users, habboId, BigInt(count));
      if (result.value !== BigInt(count)) throw new Error("Unexpected commit count.");
    } catch {
      console.warn(`Could not confirm commits for Habbo user ${habboId}; trying commits=0.`);
      try {
        const fallback = await users.giveVariable("commits", UserTargetKind.Users, habboId, 0n);
        if (fallback.value !== 0n) throw new Error("Habbo did not confirm commits=0.");
        count = 0;
      } catch {
        console.warn(`Could not confirm commits=0 for Habbo user ${habboId}; continuing with the remaining users.`);
        continue;
      }
    }
    updated.push({ habboId, githubId: githubId.toString(), commits: count });
  }
  const skipped = [...authors].filter(([id]) => !matched.has(id)).map(([, author]) => author.login);
  return { updated, skipped };
}
