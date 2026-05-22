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

import os from "os";

const PORT = process.env.PORT || 4000;

// Helper to get local IP address
const getLocalIp = () => {
  const interfaces = os.networkInterfaces();
  for (const interfaceName of Object.keys(interfaces)) {
    for (const iface of interfaces[interfaceName]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
};

server.listen(PORT, "0.0.0.0", () => {
  const localIp = getLocalIp();
  console.log(`Server Running Locally: http://localhost:${PORT}`);
  console.log(`Server Running On Network: http://${localIp}:${PORT} (Share this IP with others!)`);
});

// Handle port already in use error gracefully
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌ ERROR: Port ${PORT} is already in use!`);
    console.error(`   Run this command to fix it:`);
    console.error(`   netstat -ano | findstr :${PORT}  → then: taskkill /PID <PID> /F\n`);
    process.exit(1);
  } else {
    throw err;
  }
});