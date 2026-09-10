import { createGitHubClient, getPullRequests } from "./github.js";
import { HabboApiException, HabboPublicAPI, UserTargetKind } from "wired-api-wrapper-node";
import type { Config } from "./sync-opened-prs.js";

export async function syncRevisions(config: Config, github = createGitHubClient(config.githubToken)) {
  const reviewers = new Map<string, { login: string; count: number }>();
  // Count each submitted review once, across every PR state and review page.
  const seen = new Set<number>();
  for (const pr of await getPullRequests(github)) {
    if (!pr.user) continue; // Cannot establish whether this is a self-review.
    for await (const reviews of github.paginate.iterator(github.rest.pulls.listReviews, {
      owner: "WiredClub", repo: "docs", pull_number: pr.number, per_page: 100,
    })) {
      for (const review of reviews.data) {
        if (!review.user || !review.submitted_at || review.state === "PENDING"
          || review.user.id === pr.user.id || seen.has(review.id)) continue;
        seen.add(review.id);
        const id = String(review.user.id);
        const reviewer = reviewers.get(id) ?? { login: review.user.login, count: 0 };
        reviewer.count++;
        reviewers.set(id, reviewer);
      }
    }
  }
  for (const [id, reviewer] of reviewers) {
    const { data } = await github.rest.users.getByUsername({ username: reviewer.login });
    if (String(data.id) !== id) {
      throw new Error(`GitHub identity changed for ${reviewer.login}; revisions were not updated.`);
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
        throw new Error("Habbo returned duplicate holders; revisions were not updated.");
      }
      holders.set(holder.user.id, holder.variable.value);
    }
    if (result.items.length < 50) break;
  }

  const matched = new Set<string>();
  const updated: { habboId: number; githubId: string; revisions: number }[] = [];
  for (const [habboId, githubId] of holders) {
    if (githubId <= 0n) continue;
    const reviewer = reviewers.get(githubId.toString());
    // Set zero for linked users with no submitted reviews to clear stale counts.
    const count = reviewer?.count ?? 0;
    try {
      const result = await users.giveVariable("revisions", UserTargetKind.Users, habboId, BigInt(count));
      if (result.value !== BigInt(count)) throw new Error("Unexpected revision value.");
    } catch (error) {
      let detail = "";
      if (error instanceof HabboApiException) {
        detail = ` HTTP ${error.statusCode}.`;
        try {
          const code: unknown = JSON.parse(error.responseBody ?? "{}").error;
          if (typeof code === "string" && /^[a-z_]+(?:\.[a-z_]+)+$/.test(code)) detail += ` ${code}.`;
        } catch { /* Keep the HTTP status if the response is not JSON. */ }
      }
      throw new Error(`Could not confirm revisions=${count} for Habbo user ${habboId}.${detail} Check that the revisions user variable is configured in the room. ${updated.length} earlier user updates succeeded; rerunning will assign the totals again.`);
    }
    if (reviewer) matched.add(githubId.toString());
    updated.push({ habboId, githubId: githubId.toString(), revisions: count });
  }
  const skipped = [...reviewers].filter(([id]) => !matched.has(id)).map(([, reviewer]) => reviewer.login);
  return { updated, skipped };
}
