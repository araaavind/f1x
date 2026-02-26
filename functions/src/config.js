/**
 * F1X Backend — Configuration
 * Centralized constants for cache TTLs, API URLs, rate limits, and scheduler intervals.
 */

// Upstream API base URLs
const OPENF1_BASE = "https://api.openf1.org/v1";
const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";

// Firestore configuration
const CACHE_COLLECTION = "f1_cache";
const FIRESTORE_DB = "f1x-db"; // Named database (not the default)

// Cache TTLs (milliseconds) — how long a Firestore doc is considered fresh
const CACHE_TTL = {
  meetings: 2 * 60 * 60 * 1000, // 2 hours
  sessions: 60 * 60 * 1000, // 1 hour
  drivers: 60 * 60 * 1000, // 1 hour
  standings: 2 * 60 * 60 * 1000, // 2 hours
  sessionResult: 2 * 60 * 60 * 1000, // 2 hours
  liveData: 15 * 1000, // 15 seconds
  latestSession: 30 * 1000, // 30 seconds
};

// OpenF1 rate limits: 3 req/s AND 30 req/min
const OPENF1_RATE_LIMIT = {
  perSecond: 3,
  perMinute: 30,
};

// Jolpica rate limits: 4 req/s, 500 req/hr
const JOLPICA_RATE_LIMIT = {
  perSecond: 4,
  perMinute: 60, // conservative — well under the 500/hr cap
};

// IP rate limiting for HTTP endpoints
const IP_RATE_LIMIT = {
  maxRequests: 60, // per window
  windowMs: 60 * 1000, // 1 minute
};

// Grace period (ms) around session start/end for delay handling
// Sessions may start late or run past scheduled end, so we add a buffer
const SESSION_GRACE_PERIOD = {
  beforeStart: 30 * 60 * 1000, // 30 minutes before scheduled start
  afterEnd: 60 * 60 * 1000, // 60 minutes after scheduled end
};

module.exports = {
  OPENF1_BASE,
  JOLPICA_BASE,
  CACHE_COLLECTION,
  FIRESTORE_DB,
  CACHE_TTL,
  OPENF1_RATE_LIMIT,
  JOLPICA_RATE_LIMIT,
  IP_RATE_LIMIT,
  SESSION_GRACE_PERIOD,
};
