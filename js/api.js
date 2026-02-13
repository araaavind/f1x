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
  positions: 30 * 1000,          // 30 seconds (for live data)
  intervals: 30 * 1000,          // 30 seconds (for live data)
};

// In-memory cache
const cache = new Map();

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
      
      // Store in cache
      cache.set(fullCacheKey, { data, timestamp: Date.now() });
      
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
  
  // Check cache first
  const cached = cache.get(fullCacheKey);
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
 * Country code to flag emoji mapping
 */
const countryFlags = {
  'BHR': '🇧🇭', 'SAU': '🇸🇦', 'AUS': '🇦🇺', 'JPN': '🇯🇵', 'CHN': '🇨🇳',
  'USA': '🇺🇸', 'ITA': '🇮🇹', 'MON': '🇲🇨', 'CAN': '🇨🇦', 'ESP': '🇪🇸',
  'AUT': '🇦🇹', 'GBR': '🇬🇧', 'HUN': '🇭🇺', 'BEL': '🇧🇪', 'NLD': '🇳🇱',
  'AZE': '🇦🇿', 'SGP': '🇸🇬', 'MEX': '🇲🇽', 'BRA': '🇧🇷', 'QAT': '🇶🇦',
  'UAE': '🇦🇪', 'ABU': '🇦🇪', 'NED': '🇳🇱', 'MIA': '🇺🇸', 'LVG': '🇺🇸',
  'EMI': '🇮🇹',
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
  const cached = cache.get(cacheKey);
  
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
    
    cache.set(cacheKey, { data: standings, timestamp: Date.now() });
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
  const cached = cache.get(cacheKey);
  
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
    
    cache.set(cacheKey, { data: standings, timestamp: Date.now() });
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
  getLatestSession,
  isSessionLive,
  getUpcomingMeetings,
  getNextMeeting,
  getCountryFlag,
  getTeamColor,
  getTeamLogo,
  getDriverStandings,
  getConstructorStandings,
  determineActiveSeason,
  getActiveSeason,
};

