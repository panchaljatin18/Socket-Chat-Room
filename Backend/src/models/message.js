import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    roomId: String,
    senderId: String,
    senderName: String,
    message: String,
    seen: { type: Boolean, default: false }
  },
  {
    timestamps: true,
  }
);

const Message = mongoose.model("Message", messageSchema);

export default Message;