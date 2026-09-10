module.exports = {
  apps: [{
    name: "wired-club-sync",
    cwd: __dirname,
    script: "yarn",
    args: ["sync"],
    interpreter: "none",
    exec_mode: "fork",
    instances: 1,
    autorestart: false,
    watch: false,
    time: true,
    kill_timeout: 5000,
  }],
};
