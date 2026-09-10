import { createGitHubClient, getPullRequests, GitHubRateLimitError } from "./github.js";
import { HabboPublicAPI, Hotel } from "wired-api-wrapper-node";

export interface Config {
  hotel: Hotel;
  roomId: number;
  writeKey: string;
  readKey: string;
  githubToken?: string;
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const hotel = env.HABBO_HOTEL?.trim().toUpperCase();
  if (!Object.values(Hotel).includes(hotel as Hotel)) {
    throw new Error(`Set HABBO_HOTEL to one of: ${Object.values(Hotel).join(", ")}.`);
  }

  const rawRoomId = env.HABBO_ROOM_ID?.trim() ?? "";

  const roomId = Number(rawRoomId);
  if (!/^\d+$/.test(rawRoomId) || !Number.isSafeInteger(roomId) || roomId <= 0) {
    throw new Error("Set HABBO_ROOM_ID to a positive integer.");
  }

  const writeKey = env.HABBO_WIRED_WRITE_KEY?.trim();
  if (!writeKey) {
    throw new Error("Set HABBO_WIRED_WRITE_KEY in .env or the environment.");
  }

  const readKey = env.HABBO_WIRED_READ_KEY?.trim();
  if (!readKey) {
    throw new Error("Set HABBO_WIRED_READ_KEY in .env or the environment.");
  }

  const githubToken = env.GITHUB_TOKEN?.trim();

  return {
    hotel: hotel as Hotel,
    roomId,
    writeKey,
    readKey,
    ...(githubToken ? { githubToken } : {})
  };
}

export async function syncOpenedPrs(config: Config, github = createGitHubClient(config.githubToken)): Promise<number> {
  let count = 0;
  try {
    count = (await getPullRequests(github)).filter(pr => pr.state === "open").length;
  } catch (error) {
    if (error instanceof GitHubRateLimitError) throw error;
    throw new Error("Could not fetch all open PRs from WiredClub/docs. Habbo was not updated. Check GitHub access and rate limits.");
  }

  const variables = HabboPublicAPI.fromHotel(config.hotel)
    .variables(config.roomId, config.readKey, config.writeKey)
    .global();

  try {
    const updated = await variables.changeVariable("opened_prs", BigInt(count));
    if (updated.value !== BigInt(count)) {
      throw new Error("Unexpected value returned by Habbo.");
    }
  } catch {
    throw new Error("Habbo opened_prs update could not be confirmed. Check the room, keys, and global variable.");
  }
  return count;
}
