import express from "express";
import CallLog from "../models/CallLog.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calls/:roomId
// Fetch full call history for a room (for WhatsApp-style call log in chat)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/calls/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!roomId) {
      return res.status(400).json({ success: false, error: "roomId is required" });
    }

    const calls = await CallLog.find({ roomId }).sort({ createdAt: 1 });

    res.status(200).json({ success: true, count: calls.length, calls });
  } catch (error) {
    console.error("Fetch Call Logs REST Error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch call logs" });
  }
});

export default router;
