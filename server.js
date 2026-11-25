const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 25000, pingTimeout: 20000 });

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("connected:", socket.id);
  socket.on("disconnect", () => console.log("left:", socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Running on port " + PORT));
