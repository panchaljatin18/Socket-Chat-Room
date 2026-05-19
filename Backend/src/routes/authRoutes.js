import express from "express";

import {
  registerUser,
  loginUser,
  getProfile
} from "../controllers/authController.js";

import {
  checkAuth
} from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", registerUser);

router.post("/login", loginUser);

// Protected Route
router.get("/profile", checkAuth, getProfile);

export default router;