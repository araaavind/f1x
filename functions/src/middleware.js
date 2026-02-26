/**
 * F1X Backend — Middleware
 * IP-based rate limiting and CORS for HTTP Cloud Functions.
 */

const { IP_RATE_LIMIT } = require("./config");

// In-memory IP request counter (resets on cold start — acceptable for rate limiting)
const ipHits = new Map();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipHits) {
    if (now - entry.windowStart > IP_RATE_LIMIT.windowMs * 2) {
      ipHits.delete(ip);
    }
  }
}, 5 * 60 * 1000);

/**
 * IP rate limiting middleware.
 * Returns true if the request is allowed, false if rate-limited (429 sent).
 */
function checkRateLimit(req, res) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();

  let entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > IP_RATE_LIMIT.windowMs) {
    entry = { count: 0, windowStart: now };
    ipHits.set(ip, entry);
  }

  entry.count++;

  if (entry.count > IP_RATE_LIMIT.maxRequests) {
    res.status(429).json({
      error: "Too many requests",
      retryAfterMs: IP_RATE_LIMIT.windowMs - (now - entry.windowStart),
    });
    return false;
  }

  return true;
}

/**
 * Set CORS headers. Allows any origin (public API).
 */
function setCors(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return false;
  }

  return true;
}

/**
 * Combined middleware: CORS + rate limiting.
 * Returns true if the request should proceed, false if already handled.
 */
function applyMiddleware(req, res) {
  if (!setCors(req, res)) return false;
  if (!checkRateLimit(req, res)) return false;
  return true;
}

module.exports = { applyMiddleware };
