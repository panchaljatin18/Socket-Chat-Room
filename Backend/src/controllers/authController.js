import User from "../models/User.js";


// REGISTER
export const registerUser = async (req, res) => {

    try {

        const { username, email, password } = req.body;

        // Check required fields
        if (!username || !password) {
            return res.status(400).json({
                error: "Username and password are required"
            });
        }

        // Check existing username
        const existingUser = await User.findOne({ username });

        if (existingUser) {
            return res.status(400).json({
                error: "Username already exists"
            });
        }

        // Create new user
        const newUser = await User.create({
            username,
            email,
            password
        });

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            user: {
                id: newUser._id,
                username: newUser.username
            }
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Server Error"
        });

    }

};


// LOGIN
export const loginUser = async (req, res) => {

    try {

        const { username, password } = req.body;

        // Check required fields
        if (!username || !password) {
            return res.status(400).json({
                error: "Username and password are required"
            });
        }

        // Find user
        const user = await User.findOne({ username });

        // User not found
        if (!user) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        // Check password
        if (user.password !== password) {
            return res.status(400).json({
                error: "Invalid password"
            });
        }

        // Success response
        res.status(200).json({
            success: true,
            message: "Login successful",
            user: {
                id: user._id,
                username: user.username
            }
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Server Error"
        });

    }

};


// PROFILE
export const getProfile = async (req, res) => {

    try {

        res.status(200).json({
            success: true,
            message: "Profile Access Granted"
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Server Error"
        });

    }

};