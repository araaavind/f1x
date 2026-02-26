/**
 * F1X Backend — HTTP Endpoints (Read Layer)
 * Lightweight Cloud Functions that serve pre-cached data from Firestore.
 * No upstream API calls happen here — all data is populated by scheduled jobs.
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { CACHE_COLLECTION, FIRESTORE_DB } = require("./config");
const { applyMiddleware } = require("./middleware");

// Import scheduled functions so they are registered
const scheduled = require("./scheduled");

// Initialize Firebase Admin
initializeApp();

function db() {
  return getFirestore(FIRESTORE_DB);
}

// ---------------------------------------------------------------------------
// Helper: read a Firestore cache doc and return its data
// ---------------------------------------------------------------------------
async function readCache(docId) {
  const doc = await db().collection(CACHE_COLLECTION).doc(docId).get();
  if (!doc.exists) return null;
  return doc.data().data;
}

// ---------------------------------------------------------------------------
// Generic endpoint handler factory
// ---------------------------------------------------------------------------
function createEndpoint(docIdFn, options = {}) {
  return onRequest(
    { cors: true, memory: "256MiB", maxInstances: 10, ...options },
    async (req, res) => {
      if (!applyMiddleware(req, res)) return;

      try {
        const docId = docIdFn(req);
        if (!docId) {
          res.status(400).json({ error: "Missing required query parameters" });
          return;
        }

        const data = await readCache(docId);
        if (data === null) {
          // Data not yet cached — return empty result
          res.json([]);
          return;
        }

        res.json(data);
      } catch (error) {
        console.error("Endpoint error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );
}

// ---------------------------------------------------------------------------
// HTTP Endpoints
// ---------------------------------------------------------------------------

// Meetings for a year
exports.getMeetings = createEndpoint((req) => {
  const year = req.query.year || new Date().getFullYear();
  return `meetings_${year}`;
});

// Sessions for a specific meeting
exports.getSessions = createEndpoint((req) => {
  const meetingKey = req.query.meeting_key;
  return meetingKey ? `sessions_${meetingKey}` : null;
});

// All sessions for a year
exports.getSessionsByYear = createEndpoint((req) => {
  const year = req.query.year || new Date().getFullYear();
  return `sessions_year_${year}`;
});

// Drivers for a session
exports.getDrivers = createEndpoint((req) => {
  const sessionKey = req.query.session_key;
  return sessionKey ? `drivers_${sessionKey}` : null;
});

// Latest drivers
exports.getLatestDrivers = createEndpoint((_req) => "drivers_latest");

// Positions for a session
exports.getPositions = createEndpoint((req) => {
  const sessionKey = req.query.session_key;
  return sessionKey ? `positions_${sessionKey}` : null;
});

// Intervals for a session
exports.getIntervals = createEndpoint((req) => {
  const sessionKey = req.query.session_key;
  return sessionKey ? `intervals_${sessionKey}` : null;
});

// Session result
exports.getSessionResult = createEndpoint((req) => {
  const sessionKey = req.query.session_key;
  return sessionKey ? `result_${sessionKey}` : null;
});

// Laps for a session (optionally filtered by driver)
exports.getLaps = createEndpoint((req) => {
  const sessionKey = req.query.session_key;
  const driverNumber = req.query.driver_number || "all";
  return sessionKey ? `laps_${sessionKey}_${driverNumber}` : null;
});

// Weather for a session
exports.getWeather = createEndpoint((req) => {
  const sessionKey = req.query.session_key;
  return sessionKey ? `weather_${sessionKey}` : null;
});

// Race control messages for a session
exports.getRaceControl = createEndpoint((req) => {
  const sessionKey = req.query.session_key;
  return sessionKey ? `race_control_${sessionKey}` : null;
});

// Stints for a session
exports.getStints = createEndpoint((req) => {
  const sessionKey = req.query.session_key;
  return sessionKey ? `stints_${sessionKey}` : null;
});

// Latest session
exports.getLatestSession = createEndpoint((_req) => "latest_session");

// Driver standings
exports.getDriverStandings = createEndpoint((req) => {
  const year = req.query.year || new Date().getFullYear();
  return `driver_standings_${year}`;
});

// Constructor standings
exports.getConstructorStandings = createEndpoint((req) => {
  const year = req.query.year || new Date().getFullYear();
  return `constructor_standings_${year}`;
});

// Re-export scheduled functions
exports.refreshMeetings = scheduled.refreshMeetings;
exports.refreshStandings = scheduled.refreshStandings;
exports.refreshLiveData = scheduled.refreshLiveData;
exports.refreshBaseData = scheduled.refreshBaseData;
