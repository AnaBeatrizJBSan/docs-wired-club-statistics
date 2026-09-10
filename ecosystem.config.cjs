module.exports = {
  apps: [{
    name: "wired-club-links",
    cwd: __dirname,
    script: "yarn",
    args: ["watch:links"],
    interpreter: "none",
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    restart_delay: 5000,
    min_uptime: 10000,
    max_restarts: 10,
    watch: false,
    // The watcher already timestamps its own messages.
    time: false,
    kill_timeout: 10000,
  }],
};
