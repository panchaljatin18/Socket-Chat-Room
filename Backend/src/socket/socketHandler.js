import Message from "../models/message.js";
import Room from "../models/Room.js";

// In-memory active rooms tracking
const activeRooms = {};
const pendingDisconnects = {};

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

      socket.join(roomId);
      socket.username = username;
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

      // Case 2: The new socket joined before the old socket's disconnect event arrived
      if (activeRooms[roomId] && activeRooms[roomId].users && activeRooms[roomId].users[username]) {
        const oldSid = activeRooms[roomId].users[username];
        if (oldSid !== socket.id) {
          isReconnecting = true;
          console.log(`Suppressed join message: User ${username} was already connected via socket ${oldSid}`);
        }
      }

      // Track creators and participants in MongoDB & Memory
      if (!activeRooms[roomId]) {
        activeRooms[roomId] = {
          creatorId: socket.id,
          creatorName: username,
          users: { [username]: socket.id }
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
        activeRooms[roomId].users[username] = socket.id;

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

        // Save system message in Database
        try {
          await Message.create({
            roomId: roomId,
            senderId: "system",
            senderName: "System",
            message: joinMsg
          });
          console.log(`Saved user_joined system message for ${username} in Database`);
        } catch (dbErr) {
          console.error("Database Save User Joined System Message Error:", dbErr);
        }

        io.to(roomId).emit("user_joined", {
          username: username,
          message: joinMsg
        });
      }

      // Fetch previous messages (only from the current active session) and send to the user who joined
      try {
        const roomDoc = await Room.findOne({ roomId });
        const activatedAt = roomDoc ? roomDoc.activatedAt : new Date(0);

        const previousMessages = await Message.find({
          roomId,
          createdAt: { $gte: activatedAt }
        }).sort({ createdAt: 1 });

        socket.emit("previous_messages", previousMessages);
      } catch (dbErr) {
        console.error("Database Message Fetch Error on Join:", dbErr);
      }
    });

    // TERMINATE ROOM (Only creator can trigger)
    socket.on("terminate_room", async (roomId) => {
      const room = activeRooms[roomId];
      if (room && room.creatorId === socket.id) {
        io.to(roomId).emit("room_terminated", {
          message: "The chat session was terminated by the host."
        });
        delete activeRooms[roomId];

        // Update status to terminated in persistent Database instead of deleting
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
      // SAVE MESSAGE IN DATABASE (with senderName)
      try {
        await Message.create({
          roomId: data.roomId,
          senderId: socket.id,
          senderName: data.senderName || "Guest",
          message: data.message,
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
          for (const [uname, sid] of Object.entries(room.users)) {
            if (sid === socket.id) {
              leavingUsername = uname;
              delete room.users[uname]; // Remove from active room users map
              break;
            }
          }

          // If this socket ID was not active for any username (meaning it was already replaced
          // by a newer socket during a rapid connect-before-disconnect refresh), we can just ignore it!
          if (!leavingUsername) {
            console.log(`Socket ${socket.id} was already replaced by a newer connection. Suppressing disconnect timeout.`);
            return;
          }

          const username = leavingUsername;

          // Schedule a delayed disconnect message and potential termination
          const disconnectKey = `${roomId}_${username}`;
          
          if (pendingDisconnects[disconnectKey]) {
            clearTimeout(pendingDisconnects[disconnectKey]);
          }

          const creatorSocketId = socket.id;

          pendingDisconnects[disconnectKey] = setTimeout(async () => {
            // 1. Broadcast user_left notification if the user did not reconnect in time
            const leftMsg = `${username} disconnected from the chat room`;

            // Save system message in Database
            try {
              await Message.create({
                roomId: roomId,
                senderId: "system",
                senderName: "System",
                message: leftMsg
              });
              console.log(`Saved user_left system message for ${username} in Database`);
            } catch (dbErr) {
              console.error("Database Save User Left System Message Error:", dbErr);
            }

            io.to(roomId).emit("user_left", {
              username: username,
              message: leftMsg
            });

            // 2. If the host left, terminate the room
            const currentRoomState = activeRooms[roomId];
            if (currentRoomState && currentRoomState.creatorId === creatorSocketId) {
              io.to(roomId).emit("room_terminated", {
                message: "The chat session was terminated because the host left."
              });
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

            delete pendingDisconnects[disconnectKey];
          }, 5000); // 5 seconds grace period for refreshing/reconnecting
        }
      });
    });

    socket.on("disconnect", () => {
      console.log("Disconnected:", socket.id);
    });

  });

};

export default socketHandler;