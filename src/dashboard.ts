import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DashboardManager, projectRoot, redact } from "./dashboard-manager.js";

const port = Number(process.env.DASHBOARD_PORT ?? "3000");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("DASHBOARD_PORT must be an integer between 1024 and 65535.");
const manager = new DashboardManager();
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const assets: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const json = (status: number, data: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  if (!hosts.has(req.headers.host ?? "")) { json(403, { error: "Local access only." }); return; }
  const path = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname;
  try {
    if (req.method === "GET" && path === "/api/state") { json(200, await manager.state()); return; }
    if (req.method === "POST" && path.startsWith("/api/actions/")) {
      if (req.headers.origin !== `http://${req.headers.host}` || req.headers["content-type"] !== "application/json") {
        json(403, { error: "Actions must originate from the local dashboard." }); return;
      }
      await manager.action(path.slice("/api/actions/".length));
      json(200, { ok: true }); return;
    }
    const asset = assets[path];
    if (req.method === "GET" && asset) {
      const data = await readFile(resolve(projectRoot, "web", asset[0]));
      res.writeHead(200, { "Content-Type": asset[1] }); res.end(data); return;
    }
    json(404, { error: "Not found." });
  } catch (error) { json(409, { error: redact(error instanceof Error ? error.message : "Operation failed.") }); }
});
server.on("error", error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`Wired Club dashboard: http://127.0.0.1:${port}`));
