import { createGitHubClient } from "./github.js";
import { readConfig, syncOpenedPrs } from "./sync-opened-prs.js";
import { syncContributions } from "./sync-contributions.js";
import { syncStars } from "./sync-stars.js";
import { syncRevisions } from "./sync-revisions.js";
import { syncGitHubUsernames } from "./sync-github-usernames.js";

try {
  const config = readConfig(process.env);
  const github = createGitHubClient(config.githubToken);
  if (!config.githubToken) console.warn("GITHUB_TOKEN is missing: review synchronization can exhaust the unauthenticated GitHub quota. Set it in .env.");
  for (const user of await syncGitHubUsernames(config, github)) {
    console.log(`Linked Habbo user ${user.habboUserId} to ${user.username} (GitHub ID ${user.githubId}).`);
  }
  const count = await syncOpenedPrs(config, github);
  console.log(`Updated Habbo opened_prs to ${count} (WiredClub/docs).`);
  const stars = await syncStars(config, github);
  console.log(`Updated Habbo stars_qtd to ${stars} (WiredClub/docs).`);
  const contributions = await syncContributions(config, github);
  for (const user of contributions.updated) {
    console.log(`Updated Habbo user ${user.habboId}: contributions=${user.contributions} (GitHub ID ${user.githubId}).`);
  }
  for (const login of contributions.skipped) {
    console.log(`Skipped ${login}: no matching Habbo github_id.`);
  }
  const revisions = await syncRevisions(config, github);
  for (const user of revisions.updated) {
    console.log(`Updated Habbo user ${user.habboId}: revisions=${user.revisions} (GitHub ID ${user.githubId}).`);
  }
  for (const login of revisions.skipped) {
    console.log(`Skipped reviewer ${login}: no matching Habbo github_id.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "GitHub statistics synchronization failed.");
  process.exitCode = 1;
}
