import express from "express";
import Message from "../models/message.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/messages/:roomId
// Fetch complete persistent chat history for a room (WhatsApp-style)
// Returns ALL non-system messages sorted oldest → newest
// ─────────────────────────────────────────────────────────────────────────────
router.get("/messages/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;

    if (!roomId) {
      return res.status(400).json({ success: false, error: "roomId is required" });
    }

    const messages = await Message.find({
      roomId,
      senderId: { $ne: "system" }   // exclude join/leave system messages
    }).sort({ createdAt: 1 });      // oldest first → like WhatsApp

    res.status(200).json({
      success: true,
      count: messages.length,
      messages
    });

  } catch (error) {
    console.error("Fetch Messages REST Error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch messages" });
  }
});

export default router;
