/**
 * F1X Backend — Upstream API Client
 * Wrappers for OpenF1 and Jolpica API calls with dual rate limiting
 * (per-second + per-minute) and retry logic for 429 responses.
 */

const { OPENF1_BASE, JOLPICA_BASE, OPENF1_RATE_LIMIT, JOLPICA_RATE_LIMIT } = require("./config");

// ---------------------------------------------------------------------------
// Dual Token Bucket Rate Limiter
// Enforces both per-second and per-minute limits simultaneously.
// ---------------------------------------------------------------------------
class DualRateLimiter {
  constructor({ perSecond, perMinute }) {
    this.perSecond = perSecond;
    this.perMinute = perMinute;
    this.secondTokens = perSecond;
    this.minuteTokens = perMinute;
    this.lastSecondRefill = Date.now();
    this.lastMinuteRefill = Date.now();
    this.queue = [];
    this.processing = false;
  }

  _refill() {
    const now = Date.now();

    // Refill second bucket
    const secElapsed = (now - this.lastSecondRefill) / 1000;
    if (secElapsed >= 1) {
      this.secondTokens = Math.min(this.perSecond, this.secondTokens + Math.floor(secElapsed) * this.perSecond);
      this.lastSecondRefill = now;
    }

    // Refill minute bucket
    const minElapsed = (now - this.lastMinuteRefill) / 60000;
    if (minElapsed >= 1) {
      this.minuteTokens = Math.min(this.perMinute, this.minuteTokens + Math.floor(minElapsed) * this.perMinute);
      this.lastMinuteRefill = now;
    }
  }

  async acquire() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      this._refill();

      if (this.secondTokens > 0 && this.minuteTokens > 0) {
        this.secondTokens--;
        this.minuteTokens--;
        const resolve = this.queue.shift();
        resolve();
      } else {
        // Wait until at least one token is available
        const waitMs = this.secondTokens <= 0 ? 1000 : 2000;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    this.processing = false;
  }
}

// Per-instance rate limiters (reset on cold start, which is fine)
const openF1Limiter = new DualRateLimiter(OPENF1_RATE_LIMIT);
const jolpicaLimiter = new DualRateLimiter(JOLPICA_RATE_LIMIT);

// ---------------------------------------------------------------------------
// Fetch helpers with retry
// ---------------------------------------------------------------------------
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 3000, 8000]; // exponential-ish

async function fetchWithRetry(url, limiter) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await limiter.acquire();

    try {
      const response = await fetch(url);

      if (response.ok) {
        return await response.json();
      }

      if (response.status === 429) {
        const backoff = RETRY_BACKOFF_MS[attempt] || 8000;
        console.warn(`⚠️ 429 from ${url}, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      throw new Error(`Upstream API error ${response.status}: ${response.statusText}`);
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error;
      console.warn(`⚠️ Fetch error for ${url}: ${error.message}, retrying...`);
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt] || 2000));
    }
  }
}

// ---------------------------------------------------------------------------
// OpenF1 API calls
// ---------------------------------------------------------------------------

async function openf1(endpoint, params = {}) {
  const url = new URL(`${OPENF1_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  }
  return fetchWithRetry(url.toString(), openF1Limiter);
}

async function fetchMeetings(year) {
  return openf1("/meetings", { year });
}

async function fetchSessions(params) {
  return openf1("/sessions", params);
}

async function fetchDrivers(sessionKey) {
  return openf1("/drivers", { session_key: sessionKey });
}

async function fetchPositions(sessionKey) {
  return openf1("/position", { session_key: sessionKey });
}

async function fetchIntervals(sessionKey) {
  return openf1("/intervals", { session_key: sessionKey });
}

async function fetchSessionResult(sessionKey) {
  return openf1("/session_result", { session_key: sessionKey });
}

async function fetchLaps(sessionKey, driverNumber = null) {
  const params = { session_key: sessionKey };
  if (driverNumber) params.driver_number = driverNumber;
  return openf1("/laps", params);
}

async function fetchWeather(sessionKey) {
  return openf1("/weather", { session_key: sessionKey });
}

async function fetchRaceControl(sessionKey) {
  return openf1("/race_control", { session_key: sessionKey });
}

async function fetchStints(sessionKey) {
  return openf1("/stints", { session_key: sessionKey });
}

// ---------------------------------------------------------------------------
// Jolpica API calls
// ---------------------------------------------------------------------------

async function jolpica(endpoint) {
  const url = `${JOLPICA_BASE}${endpoint}`;
  return fetchWithRetry(url, jolpicaLimiter);
}

async function fetchDriverStandings(year) {
  const data = await jolpica(`/${year}/driverstandings.json`);
  return data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
}

async function fetchConstructorStandings(year) {
  const data = await jolpica(`/${year}/constructorstandings.json`);
  return data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
}

module.exports = {
  fetchMeetings,
  fetchSessions,
  fetchDrivers,
  fetchPositions,
  fetchIntervals,
  fetchSessionResult,
  fetchLaps,
  fetchWeather,
  fetchRaceControl,
  fetchStints,
  fetchDriverStandings,
  fetchConstructorStandings,
};
