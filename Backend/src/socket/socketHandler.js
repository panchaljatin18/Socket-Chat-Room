import Message from "../models/message.js";
import Room from "../models/Room.js";
import CallLog from "../models/CallLog.js";

// In-memory active rooms tracking
const activeRooms = {};
const pendingDisconnects = {};

// Helper: broadcast updated online users list to a room
function emitOnlineUsers(io, roomId) {
  const room = activeRooms[roomId];
  if (!room) return;
  const users = Object.keys(room.users);
  io.to(roomId).emit("online_users", users);
}

const socketHandler = (io) => {

  io.on("connection", (socket) => {

    console.log("User Connected:", socket.id);

    // JOIN ROOM
    socket.on("join_room", async (data) => {
      if (!socket.connected) return;

      let roomId = "";
      let username = "";

      // Handle both object and primitive inputs safely
      if (typeof data === "object" && data !== null) {
        roomId = data.roomId;
        username = data.username;
      } else {
        roomId = data;
        username = "Guest";
      }

      if (!roomId) return;

      // Check if user is already active in any other room
      let activeRoomId = null;
      for (const rId of Object.keys(activeRooms)) {
        if (activeRooms[rId].users && activeRooms[rId].users[username]) {
          const sids = activeRooms[rId].users[username];
          if (Array.isArray(sids) ? sids.length > 0 : sids) {
            activeRoomId = rId;
            break;
          }
        }
      }

      if (activeRoomId && activeRoomId !== roomId) {
        console.log(`User ${username} blocked from joining room ${roomId} because they are already active in room ${activeRoomId}`);
        socket.emit("join_error", {
          message: `You are already logged in and active in room "${activeRoomId}". You cannot join a different room in another tab.`
        });
        return;
      }

      socket.join(roomId);
      socket.username = username;
      socket.currentRoom = roomId;
      console.log(`${username} joined ${roomId}`);

      // Check if this is a quick reconnect/refresh to suppress join/leave notifications
      const disconnectKey = `${roomId}_${username}`;
      let isReconnecting = false;

      // Case 1: The old socket already disconnected and scheduled a timeout
      if (pendingDisconnects[disconnectKey]) {
        clearTimeout(pendingDisconnects[disconnectKey]);
        delete pendingDisconnects[disconnectKey];
        isReconnecting = true;
        console.log(`Suppressed disconnect/connect messages for refreshing user: ${username}`);
      }

      // Case 2: The new socket joined before the old socket's disconnect event arrived or user is already connected in another tab
      if (activeRooms[roomId] && activeRooms[roomId].users && activeRooms[roomId].users[username]) {
        const sids = activeRooms[roomId].users[username];
        if (Array.isArray(sids)) {
          if (!sids.includes(socket.id) && sids.length > 0) {
            isReconnecting = true;
            console.log(`Suppressed join message: User ${username} was already connected via socket(s) ${sids.join(", ")}`);
          }
        } else if (sids !== socket.id) {
          isReconnecting = true;
          console.log(`Suppressed join message: User ${username} was already connected via socket ${sids}`);
        }
      }

      // Track creators and participants in MongoDB & Memory
      if (!activeRooms[roomId]) {
        activeRooms[roomId] = {
          creatorId: socket.id,
          creatorName: username,
          users: { [username]: [socket.id] }
        };

        // Create or update persistent Room entry in Database (never deleting history)
        try {
          await Room.findOneAndUpdate(
            { roomId: roomId },
            {
              roomId: roomId,
              creatorId: socket.id,
              creatorName: username,
              participants: [username],
              status: "active",
              activatedAt: new Date()
            },
            { upsert: true, new: true }
          );
          console.log(`Saved/Updated Room ${roomId} in Database as active`);
        } catch (dbErr) {
          console.error("Database Room Create/Update Error:", dbErr);
        }

        // Tell the user they are the room creator/host
        socket.emit("room_status", { isCreator: true });
      } else {
        // If room exists, check if this user is the original host re-connecting
        if (activeRooms[roomId].creatorName === username) {
          activeRooms[roomId].creatorId = socket.id;
          socket.emit("room_status", { isCreator: true });
        } else {
          socket.emit("room_status", { isCreator: false });
        }

        // Store/Update this user's socket association
        if (!activeRooms[roomId].users[username]) {
          activeRooms[roomId].users[username] = [socket.id];
        } else if (Array.isArray(activeRooms[roomId].users[username])) {
          if (!activeRooms[roomId].users[username].includes(socket.id)) {
            activeRooms[roomId].users[username].push(socket.id);
          }
        } else {
          // Upgrade single string to array if legacy string exists
          activeRooms[roomId].users[username] = [activeRooms[roomId].users[username], socket.id];
        }

        // Update persistent Room participants list in Database
        try {
          await Room.findOneAndUpdate(
            { roomId: roomId },
            { $addToSet: { participants: username } }
          );
          console.log(`Updated Room ${roomId} participants in Database`);
        } catch (dbErr) {
          console.error("Database Room Update Error:", dbErr);
        }
      }

      // Only broadcast join notification if it is NOT a quick refresh reconnect
      if (!isReconnecting) {
        const joinMsg = `${username} connected to the chat room 🎉`;

        // broadcast to OTHERS only — joining user should NOT see their own join message
        // NOTE: System join/leave messages are NOT saved to the database intentionally
        socket.broadcast.to(roomId).emit("user_joined", {
          username: username,
          message: joinMsg
        });
      }

      // Broadcast updated online users list to all in room
      emitOnlineUsers(io, roomId);

      // Mark messages as delivered when another user joins — notify senders
      // (History is now loaded via REST API GET /api/messages/:roomId on the frontend)
      try {
        await Message.updateMany(
          { roomId: roomId, senderId: { $ne: socket.id }, delivered: { $ne: true } },
          { $set: { delivered: true } }
        );
        socket.to(roomId).emit("messages_delivered");
        console.log(`User ${username} joined room ${roomId} — messages marked as delivered`);
      } catch (dbErr) {
        console.error("Database Delivered Update Error on Join:", dbErr);
      }
    });

    // TYPING INDICATOR — broadcast to others in the room
    socket.on("typing", ({ roomId, username }) => {
      socket.to(roomId).emit("user_typing", { username });
    });

    // STOP TYPING — broadcast to others in the room
    socket.on("stop_typing", ({ roomId }) => {
      socket.to(roomId).emit("user_stop_typing");
    });

    // MESSAGE SEEN — broadcast to everyone in room that messages have been seen
    socket.on("message_seen", async ({ roomId, seenBy }) => {
      try {
        await Message.updateMany(
          { roomId: roomId, senderName: { $ne: seenBy } },
          { $set: { seen: true, delivered: true } }
        );
        console.log(`Updated messages in ${roomId} as seen and delivered by user ${seenBy}`);
      } catch (dbErr) {
        console.error("Database Update Message Seen Error:", dbErr);
      }
      socket.to(roomId).emit("messages_seen", { seenBy });
    });

    // TERMINATE ROOM (Only creator can trigger)
    socket.on("terminate_room", async (roomId) => {
      const room = activeRooms[roomId];
      if (room && room.creatorId === socket.id) {

        // 1. Broadcast termination to ALL users in the room (including host)
        io.to(roomId).emit("room_terminated", {
          message: "The chat session was terminated by the host."
        });

        // 2. Force every socket in the room to LEAVE the Socket.IO room
        //    This ensures no one can receive future messages in this room
        const socketsInRoom = await io.in(roomId).fetchSockets();
        for (const s of socketsInRoom) {
          s.leave(roomId);
          console.log(`Force-removed socket ${s.id} from terminated room ${roomId}`);
        }

        // 3. Clean up in-memory state
        delete activeRooms[roomId];

        // 4. Update status to terminated in persistent Database
        try {
          await Room.findOneAndUpdate(
            { roomId: roomId },
            { status: "terminated" }
          );
          console.log(`Marked Room ${roomId} as terminated in Database`);
        } catch (dbErr) {
          console.error("Database Room Terminate Error:", dbErr);
        }
      }
    });

    socket.on("room_exists", async (roomId) => {
      const room = await Room.findOne({ roomId });
      if (room) {
        socket.emit("room_status", {
          exists: true,
        });
      } else {
        socket.emit("room_status", { exists: false });
      }
    });

    // SEND MESSAGE
    socket.on("send_message", async (data) => {
      // Find if there are other users connected in this room
      const room = activeRooms[data.roomId];
      let hasOtherParticipants = false;
      if (room && room.users) {
        for (const u of Object.keys(room.users)) {
          if (u !== data.senderName) {
            const sids = room.users[u];
            if (sids && sids.length > 0) {
              hasOtherParticipants = true;
              break;
            }
          }
        }
      }

      // SAVE MESSAGE IN DATABASE (with senderName)
      try {
        await Message.create({
          roomId: data.roomId,
          senderId: socket.id,
          senderName: data.senderName || "Guest",
          message: data.message,
          messageType: data.messageType || "text",
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileSize: data.fileSize,
          location: data.location,
          seen: false,
          delivered: hasOtherParticipants
        });
        console.log("Saved Message in Database");
      } catch (dbErr) {
        console.error("Database Message Create Error:", dbErr);
      }

      // SEND MESSAGE TO ROOM USERS
      io.to(data.roomId).emit("receive_message", {
        senderId: socket.id,
        senderName: data.senderName || "",
        message: data.message,
        messageType: data.messageType || "text",
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        fileSize: data.fileSize,
        location: data.location,
        delivered: hasOtherParticipants,
        seen: false
      });
    });

    // DISCONNECT — Auto-terminate room if the host leaves (with grace period for refresh)
    socket.on("disconnecting", () => {
      // Check which rooms the disconnecting socket is part of
      socket.rooms.forEach((roomId) => {
        if (roomId === socket.id) return;

        const room = activeRooms[roomId];
        if (room && room.users) {
          // Find the username associated with this disconnecting socket ID
          let leavingUsername = null;
          for (const [uname, sids] of Object.entries(room.users)) {
            if (Array.isArray(sids)) {
              const index = sids.indexOf(socket.id);
              if (index !== -1) {
                sids.splice(index, 1); // Remove this socket ID
                if (sids.length === 0) {
                  leavingUsername = uname;
                  delete room.users[uname]; // Remove from active room users map
                }
                break;
              }
            } else {
              if (sids === socket.id) {
                leavingUsername = uname;
                delete room.users[uname];
                break;
              }
            }
          }

          // If this socket ID was not active for any username (meaning it was already replaced
          // by a newer socket during a rapid connect-before-disconnect refresh, or the user is still active in another tab), we can just ignore it!
          if (!leavingUsername) {
            console.log(`Socket ${socket.id} was already replaced by a newer connection or user is still active on another tab. Suppressing disconnect timeout.`);
            return;
          }

          const username = leavingUsername;

          // Immediately broadcast updated online users (user removed already above)
          emitOnlineUsers(io, roomId);

          // Schedule a delayed disconnect message and potential termination
          const disconnectKey = `${roomId}_${username}`;
          
          if (pendingDisconnects[disconnectKey]) {
            clearTimeout(pendingDisconnects[disconnectKey]);
          }

          pendingDisconnects[disconnectKey] = setTimeout(async () => {
            // 1. Broadcast user_left notification if the user did not reconnect in time
            const leftMsg = `${username} disconnected from the chat room`;

            // NOTE: System join/leave messages are NOT saved to the database intentionally
            io.to(roomId).emit("user_left", {
              username: username,
              message: leftMsg
            });

            // 2. If the host left, terminate the room
            const currentRoomState = activeRooms[roomId];
            if (currentRoomState && currentRoomState.creatorName === username) {
              // Double check if the creator has no remaining active sockets
              if (!currentRoomState.users[username] || currentRoomState.users[username].length === 0) {
                io.to(roomId).emit("room_terminated", {
                  message: "The chat session was terminated because the host left."
                });

                // Force-evict all remaining sockets from the Socket.IO room
                try {
                  const socketsInRoom = await io.in(roomId).fetchSockets();
                  for (const s of socketsInRoom) {
                    s.leave(roomId);
                  }
                } catch (e) { /* ignore */ }

                delete activeRooms[roomId];

                // Update status to terminated in persistent Database
                try {
                  await Room.findOneAndUpdate(
                    { roomId: roomId },
                    { status: "terminated" }
                  );
                  console.log(`Marked Room ${roomId} as terminated in Database (host left)`);
                } catch (dbErr) {
                  console.error("Database Room Terminate Error on Disconnect:", dbErr);
                }
              }
            }

            delete pendingDisconnects[disconnectKey];
          }, 5000); // 5 seconds grace period for refreshing/reconnecting
        }
      });
    });

    socket.on("disconnect", () => {
      console.log("Disconnected:", socket.id);
    });

    // ═══════════════════════════════════════════════════════════
    //  VIDEO CALL — WhatsApp-style WebRTC Signaling
    // ═══════════════════════════════════════════════════════════

    // In-memory call state: callId → { callerName, callerId, roomId, startedAt, answeredAt, answeredBy }
    // (keyed by callId so multiple concurrent rooms work independently)

    // ── 1. INITIATE CALL ────────────────────────────────────────
    // Caller creates the DB record, then broadcasts offer to everyone else in room
    socket.on("video_call_initiate", async ({ roomId, callerName, callId, offer }) => {
      const room = activeRooms[roomId];
      if (!room) return;

      // Collect all OTHER usernames in the room right now
      const calleeNames = Object.keys(room.users).filter(u => u !== callerName);

      // Create a pending CallLog record in DB
      try {
        await CallLog.create({
          _id: callId,   // use client-provided UUID as _id so we can update it later
          roomId,
          callerId: socket.id,
          callerName,
          calleeNames,
          status: "missed"   // default — updated if someone answers or declines
        });
        console.log(`CallLog created for call ${callId} in room ${roomId}`);
      } catch (dbErr) {
        console.error("CallLog Create Error:", dbErr);
      }

      // Relay the offer + caller info to everyone else in the room
      socket.to(roomId).emit("video_call_incoming", {
        callId,
        callerName,
        callerSocketId: socket.id,
        offer
      });
    });

    // ── 2. ICE CANDIDATE RELAY ──────────────────────────────────
    // Both sides relay ICE candidates through the server
    socket.on("ice_candidate", ({ roomId, candidate, targetSocketId }) => {
      if (targetSocketId) {
        // Direct to a specific peer
        io.to(targetSocketId).emit("ice_candidate", { candidate, fromSocketId: socket.id });
      } else {
        // Broadcast to everyone else in room (for multi-party compatibility)
        socket.to(roomId).emit("ice_candidate", { candidate, fromSocketId: socket.id });
      }
    });

    // ── 3. CALL ANSWERED — callee sends answer SDP ───────────────
    socket.on("video_call_answer", async ({ callId, roomId, answererName, callerSocketId, answer }) => {
      const now = new Date();

      // Update DB: mark as answered
      try {
        await CallLog.findByIdAndUpdate(callId, {
          status: "answered",
          answeredBy: answererName,
          answeredAt: now
        });
        console.log(`CallLog ${callId} marked as answered by ${answererName}`);
      } catch (dbErr) {
        console.error("CallLog Answer Update Error:", dbErr);
      }

      // Send answer SDP directly to the original caller
      io.to(callerSocketId).emit("video_call_answered", {
        callId,
        answererName,
        answererSocketId: socket.id,
        answer
      });

      // Tell everyone else in the room that the call is now busy (decline their popup)
      socket.to(roomId).emit("video_call_busy", {
        callId,
        answeredBy: answererName
      });
      io.to(callerSocketId); // no-op, just a note: caller is already handled above
    });

    // ── 4. CALL DECLINED by a specific user ─────────────────────
    socket.on("video_call_decline", async ({ callId, roomId, declinerName, callerSocketId }) => {
      // Update DB only if still pending (missed) — another user might have already answered
      try {
        await CallLog.findOneAndUpdate(
          { _id: callId, status: "missed" },
          { status: "declined" }
        );
        console.log(`CallLog ${callId} declined by ${declinerName}`);
      } catch (dbErr) {
        console.error("CallLog Decline Update Error:", dbErr);
      }

      // Notify the caller that this specific user declined
      io.to(callerSocketId).emit("video_call_declined", {
        callId,
        declinerName
      });
    });

    // ── 5. CALL ENDED — either side hung up ─────────────────────
    socket.on("video_call_end", async ({ callId, roomId, endedByName, targetSocketId }) => {
      const now = new Date();

      // Calculate duration if call was answered
      try {
        const log = await CallLog.findById(callId);
        if (log) {
          const durationSeconds = log.answeredAt
            ? Math.round((now - new Date(log.answeredAt)) / 1000)
            : 0;

          await CallLog.findByIdAndUpdate(callId, {
            endedAt: now,
            durationSeconds,
            // If it was never answered and someone "ended" it, mark as missed
            ...(log.status === "missed" ? { status: "missed" } : {})
          });
          console.log(`CallLog ${callId} ended. Duration: ${durationSeconds}s`);
        }
      } catch (dbErr) {
        console.error("CallLog End Update Error:", dbErr);
      }

      // Relay end signal to the other peer
      if (targetSocketId) {
        io.to(targetSocketId).emit("video_call_ended", { callId, endedByName });
      } else {
        socket.to(roomId).emit("video_call_ended", { callId, endedByName });
      }
    });

  });

};

export default socketHandler;