import express from "express";
import User from "../models/User.js";

const router = express.Router();

// REGISTER USER
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: "Username is already taken. Choose another one!" });
    }

    // Create and save user in Database
    const newUser = await User.create({
      username,
      email,
      password, // Plain text storage for simplicity and robustness
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully!",
      user: {
        id: newUser._id,
        username: newUser.username,
      },
    });
  } catch (error) {
    console.error("Registration Error:", error);
    return res.status(500).json({ error: "Server error during registration." });
  }
});

// LOGIN USER
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    // Find user in Database
    const user = await User.findOne({ username });
    if (!user || user.password !== password) {
      return res.status(400).json({ error: "Invalid username or password." });
    }

    return res.status(200).json({
      success: true,
      message: "Login successful!",
      username: user.username,
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ error: "Server error during login." });
  }
});

export default router;
