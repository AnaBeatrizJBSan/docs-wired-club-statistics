# Wired Club Habbo Room

Synchronizes the number of open pull requests in `WiredClub/docs` to the Habbo
global room variable `opened_prs`, using Octokit and `wired-api-wrapper-node`.
Sets the global variable `stars_qtd` to the repository's current star count.
Also sets each linked Habbo user's `contributions` to their total authored PRs
in that repository (open, closed, merged, and drafts).

## Setup

Use Node.js 24.16.0 (`nvm use` if you have nvm) and Yarn 1.22.22.
If Yarn is unavailable, install it with `npm install --global yarn@1.22.22`.

```sh
yarn install --frozen-lockfile
cp .env.example .env
```

Fill in `.env` with your hotel, room ID, and Wired read and write keys. The `opened_prs`
global variable must already be configured and have a stored value in that room.
The `stars_qtd` global variable must also be configured with a stored value.
Set `GITHUB_TOKEN` if the repository is private (Pull requests: Read permission).
It is also recommended for public repositories, especially when syncing reviews.
Keep credentials in the ignored `.env` file.

```sh
yarn sync
```

Each run fetches every page of open PRs, including drafts, then assigns the count
to `opened_prs`. Zero open PRs writes `0`. Each synchronization finishes its
source reads before writing its values. Failures exit with a nonzero status;
Habbo failures may require checking
the room's value before rerunning. This is a one-shot command; no recurring
schedule is configured. `yarn dev` repeats the update when source files change.

For contributions, authors are discovered from all PRs and resolved with
[`GET /users/{username}`](https://docs.github.com/en/rest/users/users#get-a-user).
Their numeric GitHub IDs are matched to stored Habbo `github_id` user-variable
values. Matching uses IDs, not Habbo names. Authors without a match are logged
and skipped, so alynva is skipped until linked, while anabeatrizjbsan can update.
Linked users with no PRs receive `0`; users with a nonpositive `github_id` are
skipped. Deleted GitHub accounts without an author object are not counted.
The configured `contributions` user variable is assigned using PUT, which can
also create the assignment for a linked user. No `github_id` assignments are created.
Counts are assigned, never incremented, so repeated runs do not double-count.
Updates are sequential: if one fails, earlier successful updates remain.

## API endpoints

### Packed GitHub usernames

`src/github-username.ts` implements the screenshot's six-bit decoder using
`bigint`. `unpack6Bit([71109, 83])` returns `qweas`. The character codes are
0=space/padding, 1–26=a–z, 27=hyphen, and 28–37=digits 0–9. This extends
the screenshot's map without changing the letter or hyphen codes. Configure
the Wired character values to use exactly this ordering. Unsupported codes
are rejected rather than silently removed. Usernames cannot start/end with
a hyphen or contain consecutive hyphens.

`decodeGitHubUsername([part1, part2, part3, part4])` validates the decoded name.
Use `bigint` or decimal strings for packed values, as ten six-bit characters can
exceed JavaScript's safe integer precision. Zero-valued unused parts decode to
empty strings. Trailing spaces are trimmed; internal spaces are invalid.
`packGitHubUsername()` is a reference encoder that groups 10/10/10/9 characters
into four parts. Each group is built from left to right: `part = part * 64 + code`.
The room must use the same character map and clear unused parts for shorter input.

`linkGitHubUsername(config, habboUserId)` reads the four permanent
`gh_user_part1`–`gh_user_part4` variables for that player, decodes the name,
looks up `/users/{username}`, and writes the returned ID to `github_id`.
The ID is always written to the same player's `github_id` user variable,
which is used by the existing contribution/review statistics.
The function rereads the parts before writing and rejects changed input.
Call it only once Wired has completed saving all four parts: rereading alone
does not provide an atomic snapshot while the bot is still accepting input.

`yarn sync` first discovers users holding `gh_user_part1`, skips empty first
parts, and resolves their usernames before updating statistics. All four
permanent parts must exist for each candidate; initialize unused parts to zero.
An invalid name, missing part, failed lookup, or changed input stops the sync;
earlier successful links remain. The bot must finish saving all parts before
running the sync. The `gh_user_char1`–`gh_user_char39` context values stay inside
Wired; the API helper reads only the permanent packed parts.

This is still a one-shot backend command. Sitting in the chair does not itself
invoke Node.js; automatic processing needs the room's integration to call the
helper after input is complete or an external scheduler. Keep the input stable
while processing it. Resolving a username looks up its public ID; it does not
verify ownership of the GitHub account.

If GitHub reports `Request quota exhausted`, set `GITHUB_TOKEN` in `.env` to a
personal access token with access to `WiredClub/docs` (fine-grained permission:
Pull requests: Read; repository metadata is also read). Create it in GitHub
Settings → Developer settings → Personal access tokens → Fine-grained tokens.
Use `WiredClub` as the resource owner when granting access to this repository;
organization approval may be required. Then rerun `yarn sync`.

[GitHub's rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
are 60 requests/hour per IP without authentication and normally 5,000/hour with
a personal access token. Reviews require at least one request per PR. The sync
shares one complete PR list among the statistics during each run; a new run
fetches fresh data. Rate-limit errors exit without automatically retrying and
include the reset time or retry delay when supplied by GitHub. Wait until then
if the token's quota is exhausted. Earlier Habbo updates in a run may already
have succeeded. `yarn dev` runs a sync on source changes, so use `yarn sync` for
controlled, one-time updates while developing.

`revisions` counts submitted reviews on other users' PRs across all PR states.
Each review counts separately, including repeat reviews on the same PR and
previously submitted reviews that were dismissed. Pending reviews, self-reviews,
and ordinary PR comments do not count. Reviews without a user and PRs without
an identifiable author are skipped. Reviewers are matched through `github_id`;
linked users with no qualifying reviews receive `0`.

Configure the `revisions` user variable in the room. The sync paginates
[`GET /repos/WiredClub/docs/pulls/{pull_number}/reviews`](https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request)
for every PR, finishes all source reads, then assigns each linked user's total
through `PUT /api/public/rooms/{roomId}/variables/user/revisions/users/{entityId}`.
As with contributions, reruns assign totals instead of incrementing them.
This requires more GitHub requests because reviews are fetched per PR.

Stars are read from `stargazers_count` in
[`GET /repos/WiredClub/docs`](https://docs.github.com/en/rest/repos/repos#get-a-repository)
and assigned using `global().changeVariable("stars_qtd", count)`. Zero stars
writes `0`; a failed or invalid GitHub response prevents the star update.

The provided **Swagger UI.pdf**, pages 19–22, documents the global variable:

- `GET /api/public/rooms/{roomId}/variables/global/{variableName}` reads its value
  with `X-Wired-Read-Key`.
- `PATCH /api/public/rooms/{roomId}/variables/global/{variableName}` updates it
  with `X-Wired-Write-Key` and JSON `{ "value": 0 }` (replace `0` with the count).
- `GET /api/public/rooms/{roomId}/variables` lists names grouped by scope
  (page 1, requires the read key).

The global update uses `global().changeVariable("opened_prs", count)`.
The PDF also documents these user-variable endpoints (pages 4–6 and 11–12):

- `GET /api/public/rooms/{roomId}/variables/user/github_id/users` lists linked
  users and values, with pagination and `X-Wired-Read-Key`.
- `PUT /api/public/rooms/{roomId}/variables/user/contributions/users/{entityId}`
  sets the user's count with `X-Wired-Write-Key` and JSON `{ "value": count }`.

The PDF documents errors for invalid values (400),
access (403), missing room/value (404), and rate limits (429).

GitHub PRs are fetched using
[`GET /repos/{owner}/{repo}/pulls`](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests)
with `state=all` and pagination once per run. `opened_prs` filters the shared
list to open PRs; contributions and revisions use all PR states. Issues are excluded.

## Commands

| Command | Purpose |
| --- | --- |
| `yarn dev` | Run `src/index.ts` and restart when files change. |
| `yarn sync` | Update `opened_prs`, `stars_qtd`, `contributions`, and `revisions` once, loading `.env`. |
| `yarn test` | Run mocked API tests without modifying Habbo. |
| `yarn typecheck` | Check TypeScript without emitting files. |
| `yarn build` | Compile TypeScript into `dist/`. |
| `yarn start` | Run the compiled entry point after building. |

Source files live in `src/`. The project uses ES modules and strict TypeScript
with NodeNext module resolution. Use `.js` extensions for relative imports in
TypeScript source, such as `import { example } from './example.js'`, so compiled
imports work in Node.js.

Commit `yarn.lock` when dependencies change. Generated files in `dist/` and
installed dependencies in `node_modules/` are ignored by Git.
