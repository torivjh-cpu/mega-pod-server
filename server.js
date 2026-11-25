const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const HOST_KEY = process.env.HOST_KEY || "";   // set this in Render → Environment
const MAX_PLAYERS = 150;
const HATS = ["santa", "elf", "antlers", "star"];

function attach(io) {
  const players = new Map();   // socket.id -> player
  let lastGoto = null;         // last agenda stop the presenter flew to
  let dirty = false;

  io.on("connection", (socket) => {
    socket.on("join", (d) => {
      d = d || {};
      if (!players.has(socket.id) && players.size >= MAX_PLAYERS) {
        socket.emit("full");
        return;
      }
      const isHost = !!HOST_KEY && d.hostKey === HOST_KEY;
      const p = {
        id: socket.id,
        name: String(d.name || "Guest").trim().slice(0, 14) || "Guest",
        color: /^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color : "#86BC25",
        hat: HATS.includes(d.hat) ? d.hat : "santa",
        x: 0, z: 26, face: 0, mv: 0,
        host: isHost,
        lastMove: 0,
      };
      players.set(socket.id, p);
      socket.emit("welcome", {
        id: socket.id,
        host: isHost,
        hostEnabled: !!HOST_KEY,
        goto: lastGoto,
        players: [...players.values()].map(pub),
      });
      socket.broadcast.emit("joined", pub(p));
    });

    socket.on("move", (d) => {
      const p = players.get(socket.id);
      if (!p || !d) return;
      const now = Date.now();
      if (now - p.lastMove < 40) return;            // basic rate limit
      const x = Number(d.x), z = Number(d.z), f = Number(d.face);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      p.lastMove = now;
      p.x = Math.max(-120, Math.min(120, x));
      p.z = Math.max(-120, Math.min(120, z));
      p.face = Number.isFinite(f) ? f : 0;
      p.mv = d.moving ? 1 : 0;
      dirty = true;
    });

    // only the host can pull everyone to the next agenda stop
    socket.on("presenter-goto", (d) => {
      const p = players.get(socket.id);
      if (!p || !p.host || !d) return;
      const id = String(d.id || "").slice(0, 24);
      if (!id) return;
      lastGoto = id;
      socket.broadcast.emit("presenter-goto", { id });
    });

    socket.on("disconnect", () => {
      if (players.delete(socket.id)) io.emit("left", socket.id);
    });
  });

  // one batched position update to everyone, 10 times a second (only if something moved)
  const tick = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    const snap = [...players.values()].map((p) => [p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.face.toFixed(2), p.mv]);
    io.volatile.emit("state", snap);
  }, 100);
  return { players, tick };
}
const pub = (p) => ({ id: p.id, name: p.name, color: p.color, hat: p.hat });

module.exports = { attach };

if (require.main === module) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { pingInterval: 25000, pingTimeout: 20000 });
  // serve the game page with the multiplayer scripts added, so index.html never needs editing
  const page = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8").replace(
    "</body>",
    '<script src="/socket.io/socket.io.js"></script>\n<script src="multiplayer.js"></script>\n</body>'
  );
  app.get(["/", "/index.html"], (req, res) => res.type("html").send(page));
  app.use(express.static("public"));
  app.get("/health", (req, res) => res.send("ok"));
  attach(io);
  if (!HOST_KEY) console.warn("WARNING: HOST_KEY is not set, so nobody can use presenter mode.");
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log("Running on port " + PORT));
}
