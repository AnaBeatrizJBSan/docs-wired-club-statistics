import { HabboPublicAPI, UserTargetKind } from "wired-api-wrapper-node";
import { createGitHubClient } from "./github.js";
import { linkGitHubUsername } from "./link-github-username.js";
import type { Config } from "./sync-opened-prs.js";

/** Run after the bot has saved the complete four-part usernames. */
export async function syncGitHubUsernames(config: Config, github = createGitHubClient(config.githubToken)) {
  const users = HabboPublicAPI.fromHotel(config.hotel)
    .variables(config.roomId, config.readKey, config.writeKey).user();
  const candidates = new Set<number>();
  const seen = new Set<number>();
  for (let page = 1; ; page++) {
    const result = await users.listHolders("gh_user_part1", UserTargetKind.Users, undefined, undefined, page, 50);
    for (const holder of result.items) {
      if (!holder.user || seen.has(holder.user.id)) throw new Error("Invalid or duplicate packed-username holder returned by Habbo.");
      seen.add(holder.user.id);
      if (holder.variable.value > 0n) candidates.add(holder.user.id);
    }
    if (result.items.length < 50) break;
  }
  const updated = [];
  for (const id of candidates) {
    updated.push(await linkGitHubUsername(config, id, github));
  }
  return updated;
}
