/* Multiplayer layer: connects the game to the server.
   If there is no server (e.g. you open the file straight from disk) it quietly does nothing. */
(function () {
  if (!window.io || !window.MPC || !window.__game) return;
  const G = window.__game;
  const socket = io();
  const hostKey = new URLSearchParams(location.search).get("host") || "";
  const MAX_SHOWN = 24;                 // draw at most this many other players (keeps it smooth)

  let joined = null;                    // our avatar details, set when the intro screen is finished
  const roster = new Map();             // id -> {name,color,hat}
  const last = new Map();               // id -> {x,z}
  let shown = new Set();
  let lastSent = "", lastSentAt = 0;

  /* little status pill under the Deloitte logo */
  const pill = document.createElement("div");
  pill.style.cssText = "position:fixed;z-index:5;left:16px;top:98px;padding:5px 12px;border-radius:999px;background:rgba(12,14,22,.74);color:#fff;font:600 12px 'Segoe UI',Arial;pointer-events:none";
  if (innerWidth < 640) pill.style.top = "54px";
  document.body.appendChild(pill);
  function paint() {
    pill.textContent = socket.connected ? "🟢 " + roster.size + " online" : "🟠 reconnecting…";
  }
  paint();

  function sendJoin() { if (joined) socket.emit("join", Object.assign({ hostKey }, joined)); }

  /* game → server */
  MPC.onEmit = (type, d) => {
    if (type === "join") { joined = { name: d.name, color: d.color, hat: d.hat }; if (socket.connected) sendJoin(); return; }
    if (!socket.connected || !joined) return;
    if (type === "move") {
      const key = d.x + "," + d.z + "," + d.face + "," + d.moving, now = Date.now();
      if (key === lastSent && now - lastSentAt < 1000) return;   // don't repeat ourselves while standing still
      lastSent = key; lastSentAt = now;
      socket.volatile.emit("move", d);
    } else if (type === "presenter-goto") {
      socket.emit("presenter-goto", d);
    }
  };

  /* server → game */
  function apply() {
    const me = G.player, want = [];
    last.forEach((p, id) => {
      if (id === socket.id || !roster.has(id)) return;
      want.push({ id, p, d: Math.hypot(p.x - me.x, p.z - me.z) });
    });
    want.sort((a, b) => a.d - b.d);
    const next = new Set();
    want.slice(0, MAX_SHOWN).forEach(({ id, p }) => {
      const r = roster.get(id);
      MPC.upsertPlayer(id, { name: r.name, color: r.color, hat: r.hat, x: p.x, z: p.z });
      next.add(id);
    });
    shown.forEach((id) => { if (!next.has(id)) MPC.removePlayer(id); });
    shown = next;
  }
  function follow(id) {
    const s = G.STATIONS.find((x) => x.id === id);
    if (s && !G.state.presenter) G.travel(s);
  }

  socket.on("connect", () => { paint(); sendJoin(); });
  socket.on("disconnect", () => { paint(); });
  socket.on("welcome", (d) => {
    roster.clear(); d.players.forEach((p) => roster.set(p.id, p));
    const btn = document.getElementById("presBtn");
    if (btn && d.hostEnabled && !d.host) btn.style.display = "none";   // only the host sees presenter mode
    if (d.host) btn && (btn.style.display = "");
    if (d.goto) follow(d.goto);
    paint();
  });
  socket.on("joined", (p) => { roster.set(p.id, p); paint(); });
  socket.on("left", (id) => { roster.delete(id); last.delete(id); if (shown.delete(id)) MPC.removePlayer(id); paint(); });
  socket.on("state", (snap) => { snap.forEach((a) => last.set(a[0], { x: a[1], z: a[2] })); apply(); });
  socket.on("presenter-goto", (d) => follow(d.id));
  socket.on("full", () => alert("This session is full. Please try again in a moment."));
})();
