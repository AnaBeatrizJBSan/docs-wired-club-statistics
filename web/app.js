const $ = id => document.getElementById(id);
let state;
let tab = "sync";
let acting = false;
let connected = false;
let actionError = "";
const actionIds = ["sync", "watcher-start", "watcher-stop", "watcher-restart"];
const labels = { idle: "Ready", running: "Running", succeeded: "Completed", failed: "Failed", online: "Listening", stopped: "Stopped", errored: "Error", "not started": "Not started", launching: "Starting", stopping: "Stopping" };
const time = value => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
function render() {
  if (!state) return;
  const { sync, watcher } = state;
  const locked = acting || state.busy || !connected;
  const activeWatcher = !["stopped", "errored", "not started"].includes(watcher.status);
  $("hotel").textContent = state.hotel;
  $("room").textContent = state.room;
  $("auth").textContent = state.authenticated ? "Authenticated" : "Public · limited quota";
  for (const [name, job] of [["sync", sync], ["watcher", watcher]]) {
    $(name + "-status").textContent = labels[job.status] || job.status;
    $(name + "-status").className = "badge " + job.status.replace(/[^a-z]/g, "-");
  }
  $("sync").disabled = locked || !state.configured || sync.status === "running" || activeWatcher;
  $("sync").textContent = sync.status === "running" ? "◌  Syncing…" : "↻  Run sync";
  $("watcher-start").disabled = locked || !state.configured || sync.status === "running" || activeWatcher;
  $("watcher-stop").disabled = locked || sync.status === "running" || !activeWatcher;
  $("watcher-restart").disabled = locked || sync.status === "running" || watcher.status === "not started";
  $("sync-detail").textContent = sync.startedAt ? `Started ${time(sync.startedAt)}${sync.finishedAt ? ` · Finished ${time(sync.finishedAt)} · Exit ${sync.exitCode ?? "unknown"}` : " · In progress"}` : "Runs once. Results appear in the activity log.";
  $("watcher-detail").textContent = watcher.status === "online" ? `Listening since ${time(watcher.startedAt)} · ${watcher.restarts} restarts` : "Managed by PM2. Keeps running in the background.";
  $("coordination").textContent = activeWatcher ? "The watcher is active. Stop it before starting a statistics sync." : sync.status === "running" ? "A sync is running. Watcher controls will return when it finishes." : "Ready to run a sync or start listening for account links.";
  const notice = actionError || (!state.configured ? "Room configuration is incomplete. Fill in the Habbo settings in .env and restart the dashboard." : "");
  $("notice").textContent = notice;
  $("notice").hidden = !notice;
  renderLogs();
}
function renderLogs() {
  if (!state) return;
  const content = tab === "sync" ? state.sync.logs : state.watcher.logs + (state.watcher.errors ? "\n── Error log ──\n" + state.watcher.errors : "");
  const placeholder = tab === "sync" ? "No sync output yet. Run a sync to see its progress here." : "No watcher output yet. Start the watcher to listen for pending links.";
  if ($("logs").textContent !== (content || placeholder)) {
    $("logs").textContent = content || placeholder;
    if ($("autoscroll").checked) $("logs").scrollTop = $("logs").scrollHeight;
  }
  $("copy").disabled = !content;
  $("log-caption").textContent = tab === "sync" ? "Latest run · session only" : "Recent PM2 output · stdout + stderr";
}
async function refresh() {
  try {
    const response = await fetch("/api/state");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not read process status.");
    const firstLoad = !state;
    state = data; connected = true;
    if (firstLoad && state.watcher.status === "online") { tab = "watcher"; selectTab(); }
    $("connection").textContent = "●  Local connection active";
    $("checked").textContent = time(Date.now());
    render();
  } catch (error) {
    connected = false;
    $("connection").textContent = "○  Connection unavailable";
    $("notice").hidden = false;
    $("notice").textContent = error.message;
    actionIds.forEach(id => { $(id).disabled = true; });
  }
}
for (const id of actionIds) $(id).addEventListener("click", async () => {
  acting = true; actionError = ""; tab = id === "sync" ? "sync" : "watcher"; selectTab(); render();
  try {
    const response = await fetch(`/api/actions/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Action failed.");
  } catch (error) { actionError = error.message; }
  finally { acting = false; await refresh(); }
});
function selectTab() {
  for (const name of ["sync", "watcher"]) {
    $("tab-" + name).classList.toggle("selected", name === tab);
    $("tab-" + name).setAttribute("aria-selected", String(name === tab));
  }
  renderLogs();
}
for (const name of ["sync", "watcher"]) $("tab-" + name).addEventListener("click", () => { tab = name; selectTab(); });
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("logs").textContent); $("copy").textContent = "Copied"; }
  catch { $("copy").textContent = "Select log to copy"; }
  setTimeout(() => { $("copy").textContent = "Copy log"; }, 1800);
});
async function poll() { await refresh(); setTimeout(poll, 3000); }
poll();
