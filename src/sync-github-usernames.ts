import { HabboPublicAPI, UserTargetKind } from "wired-api-wrapper-node";
import { createGitHubClient } from "./github.js";
import { linkGitHubUsername } from "./link-github-username.js";
import type { Config } from "./sync-opened-prs.js";

/** Run after the bot has saved the complete four-part usernames. */
export async function syncGitHubUsernames(config: Config, github = createGitHubClient(config.githubToken), log: (message: string) => void = () => {}) {
  const users = HabboPublicAPI.fromHotel(config.hotel)
    .variables(config.roomId, config.readKey, config.writeKey).user();
  const candidates = new Set<number>();
  const seen = new Set<number>();
  for (let page = 1; ; page++) {
    log(`Reading linked_gh holders, page ${page}.`);
    const result = await users.listHolders("linked_gh", UserTargetKind.Users, undefined, undefined, page, 50);
    for (const holder of result.items) {
      if (!holder.user || seen.has(holder.user.id)) throw new Error("Invalid or duplicate packed-username holder returned by Habbo.");
      seen.add(holder.user.id);
      if (holder.variable.value === 1n) candidates.add(holder.user.id);
    }
    if (result.items.length < 50) break;
  }
  log(`Checked ${seen.size} users; ${candidates.size} pending link requests.`);
  const updated = [];
  for (const id of candidates) {
    log(`Processing Habbo user ${id}.`);
    let result;
    try {
      result = await linkGitHubUsername(config, id, github, undefined, log);
    } catch (error) {
      log(`Habbo user ${id}: processing failed; see the error below.`);
      throw error;
    }
    if (result) updated.push(result);
  }
  return updated;
}
