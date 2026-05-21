import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    roomId: String,
    senderId: String,
    senderName: String,
    message: String,
    messageType: {
      type: String,
      enum: ["text", "image", "video", "document", "location"],
      default: "text"
    },
    fileUrl: String,
    fileName: String,
    fileSize: Number,
    location: {
      latitude: Number,
      longitude: Number,
      address: String
    },
    seen: { type: Boolean, default: false },
    delivered: { type: Boolean, default: false }
  },
  {
    timestamps: true,
  }
);

const Message = mongoose.model("Message", messageSchema);

export default Message;