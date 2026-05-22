import mongoose from "mongoose";

const callLogSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      index: true
    },
    callerId: {
      type: String,
      required: true
    },
    callerName: {
      type: String,
      required: true
    },
    calleeNames: {
      type: [String],    // all users who were rung (room members)
      default: []
    },
    answeredBy: {
      type: String,      // username of whoever accepted (null if missed/declined)
      default: null
    },
    status: {
      type: String,
      enum: ["answered", "missed", "declined"],
      default: "missed"
    },
    startedAt: {
      type: Date,
      default: Date.now
    },
    answeredAt: {
      type: Date,
      default: null
    },
    endedAt: {
      type: Date,
      default: null
    },
    durationSeconds: {
      type: Number,
      default: 0         // computed on call end
    }
  },
  {
    timestamps: true
  }
);

const CallLog = mongoose.model("CallLog", callLogSchema);

export default CallLog;
