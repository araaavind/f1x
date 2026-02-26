/**
 * F1X Backend — Scheduled Background Refresh
 * Cloud Scheduler triggers these functions to proactively fetch upstream data
 * and cache it in Firestore. HTTP endpoints then serve from Firestore only.
 *
 * Session delay handling:
 * - A grace period of 30 min BEFORE scheduled start and 60 min AFTER scheduled end
 *   ensures we keep polling even if sessions start late or overrun.
 *
 * Schedule summary:
 * - refreshMeetings:    every 24 hours — calendar data rarely changes
 * - refreshStandings:   every 2 hours, Fri–Mon only — standings update post-race
 * - refreshLiveData:    every 1 minute — full live data, gated by session window
 * - refreshBaseData:    every 3 hours — latest session + drivers, always runs
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { CACHE_COLLECTION, SESSION_GRACE_PERIOD, FIRESTORE_DB } = require("./config");
const upstream = require("./upstream");

function db() {
  return getFirestore(FIRESTORE_DB);
}

/**
 * Write data to a Firestore cache document.
 */
async function cacheWrite(docId, data) {
  await db().collection(CACHE_COLLECTION).doc(docId).set({
    data,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Check if a session is currently in or near its live window.
 * Accounts for delays with configurable grace periods.
 */
function isSessionInLiveWindow(session) {
  if (!session || !session.date_start || !session.date_end) return false;
  const now = Date.now();
  const start = new Date(session.date_start).getTime();
  const end = new Date(session.date_end).getTime();

  // Expand the window with grace periods for delays
  const windowStart = start - SESSION_GRACE_PERIOD.beforeStart;
  const windowEnd = end + SESSION_GRACE_PERIOD.afterEnd;

  return now >= windowStart && now <= windowEnd;
}

// ---------------------------------------------------------------------------
// Static data: meetings, standings (infrequent updates)
// ---------------------------------------------------------------------------

/**
 * Refresh meetings for the current year.
 * Runs once every 24 hours — calendar data changes at most a few times per year.
 */
exports.refreshMeetings = onSchedule(
  { schedule: "every 24 hours", timeoutSeconds: 60, memory: "256MiB" },
  async (_event) => {
    const year = new Date().getFullYear();
    console.log(`🏎️ Refreshing meetings for ${year}`);
    try {
      const data = await upstream.fetchMeetings(year);
      await cacheWrite(`meetings_${year}`, data);
      console.log(`✅ Cached ${data.length} meetings for ${year}`);

      // Also cache individual meeting sessions
      for (const meeting of data) {
        try {
          const sessions = await upstream.fetchSessions({ meeting_key: meeting.meeting_key });
          await cacheWrite(`sessions_${meeting.meeting_key}`, sessions);
        } catch (e) {
          console.warn(`⚠️ Failed to cache sessions for meeting ${meeting.meeting_key}:`, e.message);
        }
      }
    } catch (error) {
      console.error("❌ Failed to refresh meetings:", error);
    }
  }
);

/**
 * Refresh driver and constructor standings.
 * Runs every 2 hours, but only on Friday–Monday (race weekends).
 * Cron: minute 0, every 2nd hour, any day-of-month, any month, Fri-Mon (0=Sun,1=Mon,5=Fri,6=Sat)
 */
exports.refreshStandings = onSchedule(
  { schedule: "0 */2 * * 0,1,5,6", timeoutSeconds: 60, memory: "256MiB" },
  async (_event) => {
    const year = new Date().getFullYear();
    console.log(`🏎️ Refreshing standings for ${year}`);
    try {
      const [driverStandings, constructorStandings] = await Promise.all([
        upstream.fetchDriverStandings(year),
        upstream.fetchConstructorStandings(year),
      ]);
      await Promise.all([
        cacheWrite(`driver_standings_${year}`, driverStandings),
        cacheWrite(`constructor_standings_${year}`, constructorStandings),
      ]);
      console.log(`✅ Cached standings: ${driverStandings.length} drivers, ${constructorStandings.length} constructors`);
    } catch (error) {
      console.error("❌ Failed to refresh standings:", error);
    }
  }
);

// ---------------------------------------------------------------------------
// Live data: positions, intervals, stints, weather, race control, laps
// Runs every 1 minute but only fetches if a session is in its live window.
// ---------------------------------------------------------------------------

exports.refreshLiveData = onSchedule(
  { schedule: "every 1 minutes", timeoutSeconds: 55, memory: "512MiB" },
  async (_event) => {
    try {
      // Fetch the latest session info
      const sessions = await upstream.fetchSessions({ session_key: "latest" });
      const latestSession = sessions && sessions.length > 0 ? sessions[0] : null;
      await cacheWrite("latest_session", latestSession);

      if (!latestSession) {
        console.log("ℹ️ No latest session found, skipping live data refresh");
        return;
      }

      // Check if the session is in its live window (with grace periods for delays)
      if (!isSessionInLiveWindow(latestSession)) {
        console.log(`ℹ️ Session ${latestSession.session_key} not in live window, skipping`);
        return;
      }

      const sessionKey = latestSession.session_key;
      console.log(`🔴 LIVE: Refreshing live data for session ${sessionKey}`);

      // Fetch all live data endpoints in parallel (respecting rate limits via upstream module)
      const [positions, intervals, stints, weather, raceControl, drivers, laps] = await Promise.all([
        upstream.fetchPositions(sessionKey).catch((e) => { console.warn("positions:", e.message); return null; }),
        upstream.fetchIntervals(sessionKey).catch((e) => { console.warn("intervals:", e.message); return null; }),
        upstream.fetchStints(sessionKey).catch((e) => { console.warn("stints:", e.message); return null; }),
        upstream.fetchWeather(sessionKey).catch((e) => { console.warn("weather:", e.message); return null; }),
        upstream.fetchRaceControl(sessionKey).catch((e) => { console.warn("race_control:", e.message); return null; }),
        upstream.fetchDrivers(sessionKey).catch((e) => { console.warn("drivers:", e.message); return null; }),
        upstream.fetchLaps(sessionKey).catch((e) => { console.warn("laps:", e.message); return null; }),
      ]);

      // Write all non-null results to Firestore
      const writes = [];
      if (positions) writes.push(cacheWrite(`positions_${sessionKey}`, positions));
      if (intervals) writes.push(cacheWrite(`intervals_${sessionKey}`, intervals));
      if (stints) writes.push(cacheWrite(`stints_${sessionKey}`, stints));
      if (weather) writes.push(cacheWrite(`weather_${sessionKey}`, weather));
      if (raceControl) writes.push(cacheWrite(`race_control_${sessionKey}`, raceControl));
      if (drivers) {
        writes.push(cacheWrite(`drivers_${sessionKey}`, drivers));
        writes.push(cacheWrite("drivers_latest", drivers));
      }
      if (laps) writes.push(cacheWrite(`laps_${sessionKey}_all`, laps));

      await Promise.all(writes);
      console.log(`✅ Live data refreshed for session ${sessionKey} (${writes.length} docs written)`);
    } catch (error) {
      console.error("❌ Failed to refresh live data:", error);
    }
  }
);

// ---------------------------------------------------------------------------
// Baseline data: latest session + drivers
// Runs every 3 hours to keep latest_session and drivers_latest fresh
// even outside live windows (so widgets always show current info).
// ---------------------------------------------------------------------------

exports.refreshBaseData = onSchedule(
  { schedule: "every 3 hours", timeoutSeconds: 60, memory: "256MiB" },
  async (_event) => {
    try {
      console.log("🔄 Refreshing baseline session & driver data");

      // Fetch the latest session info
      const sessions = await upstream.fetchSessions({ session_key: "latest" });
      const latestSession = sessions && sessions.length > 0 ? sessions[0] : null;
      await cacheWrite("latest_session", latestSession);

      if (!latestSession) {
        console.log("ℹ️ No latest session found");
        return;
      }

      // Always refresh drivers for the latest session
      const sessionKey = latestSession.session_key;
      try {
        const drivers = await upstream.fetchDrivers(sessionKey);
        if (drivers) {
          await cacheWrite(`drivers_${sessionKey}`, drivers);
          await cacheWrite("drivers_latest", drivers);
        }
      } catch (e) {
        console.warn("⚠️ Failed to refresh drivers:", e.message);
      }

      console.log(`✅ Baseline data refreshed (session ${sessionKey})`);
    } catch (error) {
      console.error("❌ Failed to refresh baseline data:", error);
    }
  }
);
