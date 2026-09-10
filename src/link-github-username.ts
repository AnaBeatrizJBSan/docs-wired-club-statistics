import { HabboPublicAPI, UserTargetKind } from "wired-api-wrapper-node";
import { createGitHubClient } from "./github.js";
import { decodeGitHubUsername, GITHUB_CHARACTER_MAP } from "./github-username.js";
import type { Config } from "./sync-opened-prs.js";

/** Call after Wired has finished storing all four permanent user variables. */
export async function linkGitHubUsername(
  config: Config,
  habboUserId: number,
  github = createGitHubClient(config.githubToken),
  charMap = GITHUB_CHARACTER_MAP,
) {
  if (!Number.isSafeInteger(habboUserId) || habboUserId <= 0) throw new Error("A positive numeric Habbo user ID is required.");
  const variables = HabboPublicAPI.fromHotel(config.hotel).variables(config.roomId, config.readKey, config.writeKey);
  const users = variables.user();
  async function readParts() {
    const parts: bigint[] = [];
    for (let i = 1; i <= 4; i++) {
      parts.push((await users.getVariable(`gh_user_part${i}`, UserTargetKind.Users, habboUserId)).value);
    }
    return parts;
  }
  const parts = await readParts();
  const username = decodeGitHubUsername(parts, charMap);
  const { data } = await github.rest.users.getByUsername({ username });
  if (!Number.isSafeInteger(data.id) || data.id <= 0) throw new Error("GitHub returned an invalid user ID; github_id was not changed.");
  // Avoid committing a response if the player changed their input during lookup.
  const currentParts = await readParts();
  if (currentParts.some((value, i) => value !== parts[i])) {
    throw new Error("Packed username changed during lookup; github_id was not changed. Retry after input is complete.");
  }
  const id = BigInt(data.id);
  const updated = await users.giveVariable("github_id", UserTargetKind.Users, habboUserId, id);
  if (updated.value !== id) throw new Error("Habbo did not confirm the expected github_id.");
  return { habboUserId, username: data.login, githubId: data.id };
}
