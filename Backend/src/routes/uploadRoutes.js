import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, "../..");

// Ensure uploads directory exists
const uploadsDir = path.join(ROOT_DIR, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate a unique filename using timestamp and random string
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB file size limit
});

const router = express.Router();

router.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Since ROOT_DIR is served statically by Express, the path should be relative to ROOT_DIR
    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.status(200).json({
      success: true,
      fileUrl: fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size
    });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ error: "Server error during file upload" });
  }
});

export default router;
