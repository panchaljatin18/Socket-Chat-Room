import Message from "../models/message.js";
import Room from "../models/Room.js";

// In-memory active rooms tracking
const activeRooms = {};

const socketHandler = (io) => {

  io.on("connection", (socket) => {

    console.log("User Connected:", socket.id);

    // JOIN ROOM
    socket.on("join_room", async (data) => {
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
      console.log(`${username} joined ${roomId}`);

      // Track creators and participants in MongoDB & Memory
      if (!activeRooms[roomId]) {
        activeRooms[roomId] = {
          creatorId: socket.id,
          creatorName: username,
          users: [socket.id]
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
              status: "active"
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
        activeRooms[roomId].users.push(socket.id);

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

        socket.emit("room_status", { isCreator: false });
      }

      // Broadcast join notification message to all clients in the room
      io.to(roomId).emit("user_joined", {
        username: username,
        message: `${username} connected to the chat room 🎉`
      });
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

    // DISCONNECT — Auto-terminate room if the host leaves
    socket.on("disconnecting", () => {
      // Check which rooms the disconnecting socket is part of
      socket.rooms.forEach(async (roomId) => {
        const room = activeRooms[roomId];
        if (room && room.creatorId === socket.id) {
          io.to(roomId).emit("room_terminated", {
            message: "The chat session was terminated because the host left."
          });
          delete activeRooms[roomId];

          // Update status to terminated in persistent Database instead of deleting
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
      });
    });

    socket.on("disconnect", () => {
      console.log("Disconnected:", socket.id);
    });

  });

};

export default socketHandler;