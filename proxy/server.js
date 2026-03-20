// =============================
//  server.js – Production Ready
// =============================

// Load environment variables
require("dotenv").config();

// Dependencies
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

// Create Express app
const app = express();

// Middlewares
app.use(helmet()); // Basic security headers
app.use(cors());   // CORS enabled
app.use(express.json()); // Parse JSON bodies

// Optional: Serve static frontend (if any)
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// =============================
//  Example API Routes
// =============================
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Import your routes here (if you have /routes folder)
// const userRoutes = require("./routes/users");
// app.use("/api/users", userRoutes);

// =============================
//  Global Error Handler
// =============================
app.use((err, req, res, next) => {
  console.error("🔥 Server error:", err);

  res.status(err.status || 500).json({
    error: true,
    message: err.message || "Internal Server Error",
  });
});

// =============================
//  Start Server
// =============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
