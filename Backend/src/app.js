import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import userRoutes from "./routes/userRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root of the Backend/ folder (one level up from src/)
const ROOT_DIR = path.join(__dirname, "..");

const app = express();

app.use(cors());
app.use(express.json());

// API Routes for Authentication
app.use("/api", userRoutes);

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