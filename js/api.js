/**
 * F1 Dashboard - API Client
 * Handles all interactions with the OpenF1 API
 */

const API_BASE = 'https://api.openf1.org/v1';
const JOLPICA_API_BASE = 'https://api.jolpi.ca/ergast/f1';

// Cache configuration
const CACHE_DURATION = {
  meetings: 2 * 60 * 60 * 1000,      // 2 hours
  sessions: 60 * 60 * 1000,      // 1 hour
  drivers: 60 * 60 * 1000,      // 1 hour
  positions: 10 * 1000,          // 30 seconds (for live data)
  intervals: 10 * 1000,          // 30 seconds (for live data)
};

// In-memory cache
const cache = new Map();

// localStorage cache prefix
const CACHE_PREFIX = 'f1x_cache_';

/**
 * Read a cache entry, checking in-memory first, then localStorage
 */
function cacheGet(key) {
  // In-memory hit
  if (cache.has(key)) return cache.get(key);

  // localStorage fallback
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (raw) {
      const entry = JSON.parse(raw);
      // Hydrate into in-memory cache for faster subsequent reads
      cache.set(key, entry);
      return entry;
    }
  } catch (e) {
    // Corrupted entry — remove it
    localStorage.removeItem(CACHE_PREFIX + key);
  }
  return undefined;
}

/**
 * Write a cache entry to both in-memory and localStorage
 */
function cacheSet(key, entry) {
  cache.set(key, entry);
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch (e) {
    // Storage full — clear old f1x entries and retry once
    clearExpiredCache();
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch (_) { /* give up silently */ }
  }
}

/**
 * Remove expired f1x cache entries from localStorage
 */
function clearExpiredCache() {
  const now = Date.now();
  const maxAge = Math.max(...Object.values(CACHE_DURATION)); // longest TTL
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) {
      try {
        const entry = JSON.parse(localStorage.getItem(k));
        if (now - entry.timestamp > maxAge) {
          localStorage.removeItem(k);
        }
      } catch (_) {
        localStorage.removeItem(k);
      }
    }
  }
}

// Active season state
let activeSeason = new Date().getFullYear();

// In-flight requests (for deduplication)
const inFlightRequests = new Map();

// Rate limiter configuration
const RATE_LIMIT_DELAY = 250; // Minimum ms between API requests
let lastRequestTime = 0;
const requestQueue = [];
let isProcessingQueue = false;

/**
 * Process the rate-limited request queue
 */
async function processRequestQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  
  while (requestQueue.length > 0) {
    const { url, resolve, reject, fullCacheKey, cacheDuration, cached } = requestQueue.shift();
    
    // Ensure minimum delay between requests
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY - timeSinceLastRequest));
    }
    
    lastRequestTime = Date.now();
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited - wait longer and retry
          console.warn('⚠️ Rate limited, backing off...');
          await new Promise(r => setTimeout(r, 2000));
          requestQueue.unshift({ url, resolve, reject, fullCacheKey, cacheDuration, cached });
          continue;
        }
        throw new Error(`API error: ${response.status}`);
      }
      const data = await response.json();
      
      // Store in cache (in-memory + localStorage)
      cacheSet(fullCacheKey, { data, timestamp: Date.now() });
      
      resolve(data);
    } catch (error) {
      console.error('API fetch error:', error);
      // Return cached data if available, even if expired
      if (cached) {
        resolve(cached.data);
      } else {
        reject(error);
      }
    } finally {
      // Remove from in-flight requests when done
      inFlightRequests.delete(fullCacheKey);
    }
  }
  
  isProcessingQueue = false;
}

/**
 * Fetch data from OpenF1 API with caching and request deduplication
 * Uses rate limiting to prevent 429 errors
 */
async function fetchAPI(endpoint, params = {}, cacheKey = null, cacheDuration = 60000) {
  const url = new URL(`${API_BASE}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const fullCacheKey = cacheKey || url.toString();
  
  // Check cache first (in-memory, then localStorage)
  const cached = cacheGet(fullCacheKey);
  if (cached && Date.now() - cached.timestamp < cacheDuration) {
    return cached.data;
  }

  // Check if there's already an in-flight request for this key
  if (inFlightRequests.has(fullCacheKey)) {
    return inFlightRequests.get(fullCacheKey);
  }

  // Create the request promise using rate-limited queue
  const requestPromise = new Promise((resolve, reject) => {
    requestQueue.push({
      url: url.toString(),
      resolve,
      reject,
      fullCacheKey,
      cacheDuration,
      cached
    });
    processRequestQueue();
  });

  // Store the in-flight request
  inFlightRequests.set(fullCacheKey, requestPromise);

  return requestPromise;
}

/**
 * Get all meetings (Grand Prix weekends) for a year
 */
/**
 * Get all meetings (Grand Prix weekends) for a year
 */
async function getMeetings(year = activeSeason) {
  return fetchAPI('/meetings', { year }, `meetings_${year}`, CACHE_DURATION.meetings);
}

/**
 * Determine the active season
 * If the current season is over (no upcoming races), switch to next year
 */
async function determineActiveSeason() {
  const currentYear = new Date().getFullYear();
  const now = new Date();
  
  try {
    // Check current year's meetings
    const meetings = await getMeetings(currentYear);
    
    // Find if there are any upcoming races in current year
    const upcoming = meetings.filter(m => new Date(m.date_start) > now);
    
    if (upcoming.length === 0) {
      // Current season is over, check if next year has meetings
      const nextYear = currentYear + 1;
      const nextYearMeetings = await getMeetings(nextYear);
      
      if (nextYearMeetings && nextYearMeetings.length > 0) {
        console.log(`🏁 Season ${currentYear} is over. Switching to ${nextYear}.`);
        activeSeason = nextYear;
        return nextYear;
      }
    }
    
    activeSeason = currentYear;
    return currentYear;
  } catch (e) {
    console.error('Error determining active season:', e);
    activeSeason = currentYear;
    return currentYear;
  }
}

/**
 * Get the currently active season year
 */
function getActiveSeason() {
  return activeSeason;
}

/**
 * Get sessions for a meeting
 */
async function getSessions(meetingKey) {
  return fetchAPI('/sessions', { meeting_key: meetingKey }, `sessions_${meetingKey}`, CACHE_DURATION.sessions);
}

/**
 * Get all sessions for a year
 */
async function getSessionsByYear(year = new Date().getFullYear()) {
  return fetchAPI('/sessions', { year }, `sessions_year_${year}`, CACHE_DURATION.sessions);
}

/**
 * Get drivers for a session
 */
async function getDrivers(sessionKey) {
  return fetchAPI('/drivers', { session_key: sessionKey }, `drivers_${sessionKey}`, CACHE_DURATION.drivers);
}

/**
 * Get latest driver info (most recent session)
 */
async function getLatestDrivers() {
  try {
    // Get the most recent session to get current driver data
    const sessions = await fetchAPI('/sessions', { session_key: 'latest' }, 'sessions_latest', CACHE_DURATION.sessions);
    if (sessions && sessions.length > 0) {
      const latestSession = sessions[0];
      return fetchAPI('/drivers', { session_key: latestSession.session_key }, `drivers_latest`, CACHE_DURATION.drivers);
    }
    return [];
  } catch (error) {
    console.error('Error getting latest drivers:', error);
    return [];
  }
}

/**
 * Get current positions for a session
 */
async function getPositions(sessionKey) {
  return fetchAPI('/position', { session_key: sessionKey }, `positions_${sessionKey}`, CACHE_DURATION.positions);
}

/**
 * Get intervals (gaps) for a session
 */
async function getIntervals(sessionKey) {
  return fetchAPI('/intervals', { session_key: sessionKey }, `intervals_${sessionKey}`, CACHE_DURATION.intervals);
}

/**
 * Get session results
 */
async function getSessionResult(sessionKey) {
  return fetchAPI('/session_result', { session_key: sessionKey }, `result_${sessionKey}`, CACHE_DURATION.meetings);
}

/**
 * Get laps for a driver in a session
 */
async function getLaps(sessionKey, driverNumber = null) {
  const params = { session_key: sessionKey };
  if (driverNumber) params.driver_number = driverNumber;
  return fetchAPI('/laps', params, `laps_${sessionKey}_${driverNumber || 'all'}`, CACHE_DURATION.positions);
}

/**
 * Get weather data for a session
 */
async function getWeather(sessionKey) {
  return fetchAPI('/weather', { session_key: sessionKey }, `weather_${sessionKey}`, CACHE_DURATION.positions);
}

/**
 * Get race control messages for a session
 */
async function getRaceControl(sessionKey) {
  return fetchAPI('/race_control', { session_key: sessionKey }, `race_control_${sessionKey}`, CACHE_DURATION.positions);
}

/**
 * Get the latest/current session
 */
async function getLatestSession() {
  try {
    const sessions = await fetchAPI('/sessions', { session_key: 'latest' }, 'latest_session', 30000);
    return sessions && sessions.length > 0 ? sessions[0] : null;
  } catch (error) {
    console.error('Error getting latest session:', error);
    return null;
  }
}

/**
 * Check if a session is currently live
 */
function isSessionLive(session) {
  if (!session) return false;
  const now = new Date();
  const start = new Date(session.date_start);
  const end = new Date(session.date_end);
  return now >= start && now <= end;
}

/**
 * Get upcoming meetings (future Grand Prix)
 */
async function getUpcomingMeetings() {
  const year = new Date().getFullYear();
  const meetings = await getMeetings(year);
  const now = new Date();
  
  return meetings
    .filter(m => new Date(m.date_start) > now)
    .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
}

/**
 * Get the next upcoming meeting
 */
async function getNextMeeting() {
  const upcoming = await getUpcomingMeetings();
  return upcoming.length > 0 ? upcoming[0] : null;
}

/**
 * Circuit SVG mapping: circuit_short_name (from OpenF1) -> layoutId (from f1-circuits-svg repo)
 * Uses the latest layout for each circuit that covers the 2024-2026 seasons
 */
const circuitSvgMap = {
  'bahrain': 'bahrain-1',
  'sakhir': 'bahrain-1',
  'jeddah': 'jeddah-1',
  'albert park': 'melbourne-2',
  'melbourne': 'melbourne-2',
  'suzuka': 'suzuka-2',
  'shanghai': 'shanghai-1',
  'miami': 'miami-1',
  'imola': 'imola-3',
  'monaco': 'monaco-5',
  'montreal': 'montreal-6',
  'villeneuve': 'montreal-6',
  'barcelona': 'catalunya-6',
  'catalunya': 'catalunya-6',
  'spielberg': 'spielberg-3',
  'red bull ring': 'spielberg-3',
  'silverstone': 'silverstone-8',
  'hungaroring': 'hungaroring-3',
  'spa-francorchamps': 'spa-francorchamps-4',
  'spa': 'spa-francorchamps-4',
  'zandvoort': 'zandvoort-5',
  'monza': 'monza-6',
  'baku': 'baku-1',
  'marina bay': 'marina-bay-4',
  'singapore': 'marina-bay-4',
  'austin': 'austin-1',
  'cota': 'austin-1',
  'mexico city': 'mexico-city-3',
  'hermanos rodriguez': 'mexico-city-3',
  'interlagos': 'interlagos-2',
  'sao paulo': 'interlagos-2',
  'são paulo': 'interlagos-2',
  'las vegas': 'las-vegas-1',
  'lusail': 'lusail-1',
  'yas marina': 'yas-marina-2',
  'yas island': 'yas-marina-2',
  'madrid': 'madring-1',
  'portimao': 'portimao-1',
  'istanbul': 'istanbul-1',
  'istanbul park': 'istanbul-1',
  'paul ricard': 'paul-ricard-3',
  'mugello': 'mugello-1',
  'nurburgring': 'nurburgring-4',
  'nürburgring': 'nurburgring-4',
  'hockenheim': 'hockenheimring-4',
  'hockenheimring': 'hockenheimring-4',
  'sepang': 'sepang-1',
  'buddh': 'buddh-1',
  'valencia': 'valencia-1',
  'yeongam': 'yeongam-1',
  'sochi': 'sochi-1',
};

/**
 * Fallback mapping from meeting_name keywords to layoutId
 */
const meetingCircuitMap = {
  'bahrain': 'bahrain-1',
  'saudi': 'jeddah-1',
  'australian': 'melbourne-2',
  'japanese': 'suzuka-2',
  'chinese': 'shanghai-1',
  'miami': 'miami-1',
  'emilia': 'imola-3',
  'monaco': 'monaco-5',
  'canadian': 'montreal-6',
  'spanish': 'catalunya-6',
  'austrian': 'spielberg-3',
  'british': 'silverstone-8',
  'hungarian': 'hungaroring-3',
  'belgian': 'spa-francorchamps-4',
  'dutch': 'zandvoort-5',
  'italian': 'monza-6',
  'azerbaijan': 'baku-1',
  'singapore': 'marina-bay-4',
  'united states': 'austin-1',
  'mexico': 'mexico-city-3',
  'são paulo': 'interlagos-2',
  'sao paulo': 'interlagos-2',
  'brazilian': 'interlagos-2',
  'las vegas': 'las-vegas-1',
  'qatar': 'lusail-1',
  'abu dhabi': 'yas-marina-2',
  'madrid': 'madring-1',
};

/**
 * Get the local circuit SVG path for a given circuit short name and/or meeting name
 * @param {string} circuitShortName - Circuit short name from OpenF1
 * @param {string} meetingName - Meeting name fallback
 * @param {'white'|'white-outline'|'black'|'black-outline'} variant - SVG style variant
 */
function getCircuitSvgUrl(circuitShortName, meetingName, variant = 'white') {
  let layoutId = null;

  if (circuitShortName) {
    const key = circuitShortName.toLowerCase().trim();
    if (circuitSvgMap[key]) {
      layoutId = circuitSvgMap[key];
    } else {
      // Try partial match on circuit name
      const partialKey = Object.keys(circuitSvgMap).find(k => key.includes(k) || k.includes(key));
      if (partialKey) layoutId = circuitSvgMap[partialKey];
    }
  }

  // Fallback: try matching by meeting name
  if (!layoutId && meetingName) {
    const nameLower = meetingName.toLowerCase();
    const meetingKey = Object.keys(meetingCircuitMap).find(k => nameLower.includes(k));
    if (meetingKey) layoutId = meetingCircuitMap[meetingKey];
  }

  return layoutId ? `circuits/${variant}/${layoutId}.svg` : null;
}

/**
 * Country code to flag emoji mapping
 */
const countryFlags = {
  'BHR': '🇧🇭', 'BRN': '🇧🇭', 'SAU': '🇸🇦', 'KSA': '🇸🇦', 'AUS': '🇦🇺',
  'USA': '🇺🇸', 'ITA': '🇮🇹', 'MON': '🇲🇨', 'CAN': '🇨🇦', 'ESP': '🇪🇸',
  'AUT': '🇦🇹', 'GBR': '🇬🇧', 'HUN': '🇭🇺', 'BEL': '🇧🇪', 'NLD': '🇳🇱',
  'AZE': '🇦🇿', 'SGP': '🇸🇬', 'MEX': '🇲🇽', 'BRA': '🇧🇷', 'QAT': '🇶🇦',
  'UAE': '🇦🇪', 'ABU': '🇦🇪', 'NED': '🇳🇱', 'MIA': '🇺🇸', 'LVG': '🇺🇸',
  'EMI': '🇮🇹', 'JPN': '🇯🇵', 'CHN': '🇨🇳',
};

function getCountryFlag(countryCode) {
  return countryFlags[countryCode] || '🏁';
}

/**
 * Team colors mapping (fallback if not in API)
 */
const teamColors = {
  'Red Bull Racing': '#3671C6',
  'Ferrari': '#E8002D',
  'McLaren': '#FF8700',
  'Mercedes': '#27F4D2',
  'Aston Martin': '#229971',
  'Alpine': '#FF87BC',
  'Williams': '#64C4FF',
  'RB': '#6692FF',
  'Audi': '#E8002D',  // Audi F1 (formerly Kick Sauber)
  'Cadillac': '#C4A747',  // Cadillac F1 (new team 2026)
  'Haas F1 Team': '#B6BABD',
  // Legacy entries for API compatibility
  'Kick Sauber': '#E8002D',
};

/**
 * Team logos mapping - using F1 official media CDN
 * Format: team name -> logo URL
 */
const teamLogos = {
  'Red Bull Racing': 'https://media.formula1.com/image/upload/c_lfill,w_64/q_auto/v1740000000/common/f1/2026/redbullracing/2026redbullracinglogowhite.webp',
  'Ferrari': 'https://media.formula1.com/image/upload/c_lfill,w_64/q_auto/v1740000000/common/f1/2026/ferrari/2026ferrarilogowhite.webp',
  'McLaren': 'https://media.formula1.com/image/upload/c_lfill,w_40/q_auto/v1740000000/common/f1/2026/mclaren/2026mclarenlogowhite.webp',
  'Mercedes': 'https://media.formula1.com/image/upload/c_lfill,w_64/q_auto/v1740000000/common/f1/2026/mercedes/2026mercedeslogowhite.webp',
  'Aston Martin': 'https://media.formula1.com/image/upload/c_lfill,w_64/q_auto/v1740000000/common/f1/2026/astonmartin/2026astonmartinlogowhite.webp',
  'Alpine': 'https://media.formula1.com/image/upload/c_lfill,w_40/q_auto/v1740000000/common/f1/2026/alpine/2026alpinelogowhite.webp',
  'Williams': 'https://media.formula1.com/image/upload/c_lfill,w_64/q_auto/v1740000000/common/f1/2026/williams/2026williamslogowhite.webp',
  'RB': 'https://media.formula1.com/image/upload/c_lfill,w_64/q_auto/v1740000000/common/f1/2026/racingbulls/2026racingbullslogowhite.webp',
  'Audi': 'https://media.formula1.com/image/upload/c_lfill,w_64/q_auto/v1740000000/common/f1/2026/audi/2026audilogowhite.webp',
  'Cadillac': 'https://media.formula1.com/image/upload/c_lfill,w_64/q_auto/v1740000000/common/f1/2026/cadillac/2026cadillaclogowhite.webp',
  'Haas F1 Team': 'https://media.formula1.com/image/upload/c_lfill,w_64/q_auto/v1740000000/common/f1/2026/haasf1team/2026haasf1teamlogowhite.webp',
  // Legacy entries for API compatibility
  'Kick Sauber': 'https://media.formula1.com/image/upload/c_lfill,w_64/q_auto/v1740000000/common/f1/2026/audi/2026audilogowhite.webp',
};

function getTeamLogo(teamName) {
  // Try exact match first
  if (teamLogos[teamName]) return teamLogos[teamName];
  
  // Try partial match
  const key = Object.keys(teamLogos).find(k => 
    teamName.toLowerCase().includes(k.toLowerCase().split(' ')[0]) ||
    k.toLowerCase().includes(teamName.toLowerCase().split(' ')[0])
  );
  return key ? teamLogos[key] : null;
}

function getTeamColor(teamName, apiColor = null) {
  if (apiColor) return `#${apiColor}`;
  return teamColors[teamName] || '#888888';
}

/**
 * Fetch driver standings from Jolpica API
 */
/**
 * Fetch driver standings from Jolpica API
 */
async function getDriverStandings(year = null) {
  const season = year || activeSeason;
  const cacheKey = `driver_standings_${season}`;
  const cached = cacheGet(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION.meetings) {
    return cached.data;
  }

  try {
    const response = await fetch(`${JOLPICA_API_BASE}/${season}/driverstandings.json`);
    if (!response.ok) {
      throw new Error(`Jolpica API error: ${response.status}`);
    }
    const data = await response.json();
    const standings = data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];

    cacheSet(cacheKey, { data: standings, timestamp: Date.now() });
    return standings;
  } catch (error) {
    console.error('Error fetching driver standings:', error);
    if (cached) return cached.data;
    return [];
  }
}

/**
 * Fetch constructor standings from Jolpica API
 */
/**
 * Fetch constructor standings from Jolpica API
 */
async function getConstructorStandings(year = null) {
  const season = year || activeSeason;
  const cacheKey = `constructor_standings_${season}`;
  const cached = cacheGet(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION.meetings) {
    return cached.data;
  }

  try {
    const response = await fetch(`${JOLPICA_API_BASE}/${season}/constructorstandings.json`);
    if (!response.ok) {
      throw new Error(`Jolpica API error: ${response.status}`);
    }
    const data = await response.json();
    const standings = data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];

    cacheSet(cacheKey, { data: standings, timestamp: Date.now() });
    return standings;
  } catch (error) {
    console.error('Error fetching constructor standings:', error);
    if (cached) return cached.data;
    return [];
  }
}

// Export functions
window.F1API = {
  getMeetings,
  getSessions,
  getSessionsByYear,
  getDrivers,
  getLatestDrivers,
  getPositions,
  getIntervals,
  getSessionResult,
  getLaps,
  getWeather,
  getRaceControl,
  getLatestSession,
  isSessionLive,
  getUpcomingMeetings,
  getNextMeeting,
  getCountryFlag,
  getCircuitSvgUrl,
  getTeamColor,
  getTeamLogo,
  getDriverStandings,
  getConstructorStandings,
  determineActiveSeason,
  getActiveSeason,
};

