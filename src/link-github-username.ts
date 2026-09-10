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
  log: (message: string) => void = () => {},
) {
  if (!Number.isSafeInteger(habboUserId) || habboUserId <= 0) throw new Error("A positive numeric Habbo user ID is required.");
  const variables = HabboPublicAPI.fromHotel(config.hotel).variables(config.roomId, config.readKey, config.writeKey);
  const users = variables.user();
  const ready = await users.getVariable("linked_gh", UserTargetKind.Users, habboUserId);
  if (ready.value !== 1n) {
    log(`Habbo user ${habboUserId}: skipped, linked_gh=${ready.value}.`);
    return null;
  }
  log(`Habbo user ${habboUserId}: reading packed username.`);
  async function readParts() {
    const parts: bigint[] = [];
    for (let i = 1; i <= 4; i++) {
      parts.push((await users.getVariable(`gh_user_part${i}`, UserTargetKind.Users, habboUserId)).value);
    }
    return parts;
  }
  const parts = await readParts();
  async function stillPending() {
    const currentParts = await readParts();
    const status = await users.getVariable("linked_gh", UserTargetKind.Users, habboUserId);
    return status.value === 1n && status.updateTime === ready.updateTime
      && currentParts.every((value, i) => value === parts[i]);
  }
  async function setStatus(value: bigint) {
    const result = await users.changeVariable("linked_gh", UserTargetKind.Users, habboUserId, value);
    if (result.value !== value) throw new Error("Habbo did not confirm linked_gh status.");
  }
  async function rejectInput(reason: string) {
    if (await stillPending()) {
      await setStatus(3n);
      log(`Habbo user ${habboUserId}: ${reason}; linked_gh=3.`);
    } else {
      log(`Habbo user ${habboUserId}: input changed; rejection was not saved.`);
    }
    return null;
  }
  let username: string;
  try {
    username = decodeGitHubUsername(parts, charMap);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown decoding error.";
    const input = parts.map((value, index) => `gh_user_part${index + 1}=${value.toString()}`).join(", ");
    return rejectInput(`invalid packed username: ${reason} Input: ${input}`);
  }
  log(`Habbo user ${habboUserId}: looking up GitHub username ${username}.`);
  const data = await github.rest.users.getByUsername({ username }).then(response => response.data).catch(error => {
    // Only a GitHub 404 is a definitive invalid-account result.
    if (error?.status === 404) return null;
    throw error;
  });
  if (!data) return rejectInput(`GitHub account "${username}" not found (HTTP 404)`);
  if (!Number.isSafeInteger(data.id) || data.id <= 0) throw new Error("GitHub returned an invalid user ID; github_id was not changed.");
  if (!await stillPending()) {
    log(`Habbo user ${habboUserId}: input changed during lookup; update skipped.`);
    return null;
  }
  const id = BigInt(data.id);
  log(`Habbo user ${habboUserId}: saving github_id=${id}.`);
  const updated = await users.giveVariable("github_id", UserTargetKind.Users, habboUserId, id);
  if (updated.value !== id) throw new Error("Habbo did not confirm the expected github_id.");
  // Keep the request pending if this write fails; assigning the same ID is retry-safe.
  await setStatus(2n);
  log(`Habbo user ${habboUserId}: linked to ${data.login}, github_id=${id}, linked_gh=2.`);
  return { habboUserId, username: data.login, githubId: data.id };
}
