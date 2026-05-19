export const checkAuth = (req, res, next) => {

    try {

        // Get token from headers
        const token = req.headers.authorization;

        // Check token exists
        if (!token) {
            return res.status(401).json({
                success: false,
                error: "Access Denied. No token provided."
            });
        }

        // If token exists
        next();

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            error: "Server Error"
        });

    }

};