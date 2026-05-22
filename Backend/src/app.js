import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/authRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import callRoutes from "./routes/callRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root of the Backend/ folder (one level up from src/)
const ROOT_DIR = path.join(__dirname, "..");

const app = express();

app.use(cors());
app.use(express.json());

// API Routes for Authentication, Uploads, and Messages
app.use("/api", authRoutes);
app.use("/api", uploadRoutes);
app.use("/api", messageRoutes);
app.use("/api", callRoutes);

// Serve static HTML files from Backend/ root
app.use(express.static(ROOT_DIR));

// Explicit route for signup page
app.get("/signup", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "signup.html"));
});

// Explicit route for login page
app.get("/login", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "login.html"));
});

// Fallback — serve index.html for the root
app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

export default app;