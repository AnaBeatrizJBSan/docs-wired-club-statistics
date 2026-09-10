import { createGitHubClient, GitHubRateLimitError } from "./github.js";
import { HabboPublicAPI } from "wired-api-wrapper-node";
import type { Config } from "./sync-opened-prs.js";

export async function syncStars(config: Config, github = createGitHubClient(config.githubToken)): Promise<number> {
  let count: number;
  try {
    const { data } = await github.rest.repos.get({ owner: "WiredClub", repo: "docs" });
    count = data.stargazers_count;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Invalid star count.");
    }
  } catch (error) {
    if (error instanceof GitHubRateLimitError) throw error;
    throw new Error("Could not fetch the star count from WiredClub/docs. Habbo stars_qtd was not updated.");
  }

  const variables = HabboPublicAPI.fromHotel(config.hotel)
    .variables(config.roomId, config.readKey, config.writeKey).global();
  try {
    const updated = await variables.changeVariable("stars_qtd", BigInt(count));
    if (updated.value !== BigInt(count)) throw new Error("Unexpected value returned by Habbo.");
  } catch {
    throw new Error("Habbo stars_qtd update could not be confirmed. Check the room, keys, and global variable.");
  }
  return count;
}
