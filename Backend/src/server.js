import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";

// LOAD ENV FIRST
dotenv.config();

import app from "./app.js";
import connectDB from "./config/db.js";
import socketHandler from "./socket/socketHandler.js";

// TEST ENV
console.log(process.env.MONGO_URI);

connectDB();

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

socketHandler(io);

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`Server Running On ${PORT}`);
});