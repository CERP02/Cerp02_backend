"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
// Import the jsonwebtoken library to verify JWT tokens
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// requireAuth is an Express middleware that protects routes from unauthenticated access
// It reads the JWT from the Authorization header, verifies it, and attaches the payload to req.user
function requireAuth(
// req is the incoming HTTP request — extended with the user property
req, 
// res is used to send error responses if the token is missing or invalid
res, 
// next is called to pass control to the next middleware or route handler
next) {
    // Read the Authorization header from the request
    const authHeader = req.headers.authorization;
    // If no Authorization header is present, or it does not start with "Bearer ", reject the request
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        // Send a 401 Unauthorized response with an error message
        res.status(401).json({ error: "No token provided. Please log in." });
        // Return early to stop execution — next() is not called
        return;
    }
    // Extract the token string by removing the "Bearer " prefix
    const token = authHeader.split(" ")[1];
    try {
        // Verify the token using the JWT_SECRET from the environment variables
        // If the token is invalid or expired, jwt.verify will throw an error
        const decoded = jsonwebtoken_1.default.verify(
        // The JWT token string to verify
        token, 
        // The secret key used to sign and verify tokens
        process.env.JWT_SECRET);
        // Attach the decoded payload to the request object so route handlers can access user info
        req.user = decoded;
        // Call next() to pass control to the next middleware or route handler
        next();
    }
    catch {
        // If verification fails (wrong secret, expired token, malformed token), reject the request
        res.status(401).json({ error: "Invalid or expired token. Please log in again." });
    }
}
// requireRole returns a middleware that restricts a route to users with specific roles
// It must be used after requireAuth since it depends on req.user being set
function requireRole(...roles) {
    // Return a standard Express middleware function
    return (req, res, next) => {
        // If req.user is not set, the user is not authenticated
        if (!req.user) {
            // Send a 401 Unauthorized response
            res.status(401).json({ error: "Not authenticated" });
            // Stop execution
            return;
        }
        // Check if the user's role is in the list of allowed roles
        if (!roles.includes(req.user.role)) {
            // Send a 403 Forbidden response explaining which role is needed
            res.status(403).json({
                // List the required roles in the error message
                error: `Access denied. Required role: ${roles.join(" or ")}`,
            });
            // Stop execution
            return;
        }
        // The user has one of the required roles — pass control to the route handler
        next();
    };
}
