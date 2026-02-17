/**
 * F1 Dashboard - Widget Rendering
 * Using event delegation instead of inline handlers (CSP compliant)
 */

let currentDrivers = [];
let currentMeetings = [];
let countdownInterval = null;

/**
 * Setup error handlers for images (CSP compliant - no inline handlers)
 */
function setupImageErrorHandlers(container) {
  const images = container.querySelectorAll('img[data-fallback]');
  images.forEach(img => {
    img.addEventListener('error', function() {
      const fallback = this.getAttribute('data-fallback');
      if (fallback === 'hide') {
        this.style.display = 'none';
      } else if (fallback) {
        this.src = fallback;
      }
    }, { once: true });
  });
}

// 2024 Season Stats (OpenF1 doesn't provide championship data)
// These will be populated dynamically from Jolpica API
let driverStandingsData = [];
let constructorStandingsData = [];

/**
 * Render Next Race Countdown with Schedule
 */
async function renderNextRaceWidget() {
  const content = document.getElementById('next-race-content');
  
  try {
    const year = F1API.getActiveSeason();
    const meetings = await F1API.getMeetings(year);
    currentMeetings = meetings;
    
    const now = new Date();
    const upcoming = meetings
      .filter(m => new Date(m.date_start) > new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000))
      .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
    
    if (upcoming.length === 0) {
      content.innerHTML = '<div class="no-data"><span>No upcoming races</span></div>';
      return;
    }
    
    const next = upcoming[0];
    const circuitSvgUrl = F1API.getCircuitSvgUrl(next.circuit_short_name, next.meeting_name, 'white-outline');
    
    // Fetch sessions for this meeting
    let sessions = [];
    try {
      sessions = await F1API.getSessions(next.meeting_key);
    } catch (e) {
      console.warn('Could not fetch sessions:', e);
    }
    
    // Format date range (e.g., "Mar 06-09")
    const startDate = new Date(next.date_start);
    const endDate = next.date_end ? new Date(next.date_end) : new Date(startDate.getTime() + 3 * 24 * 60 * 60 * 1000);
    const month = startDate.toLocaleDateString('en-US', { month: 'short' });
    const startDay = startDate.getDate().toString().padStart(2, '0');
    const endDay = endDate.getDate().toString().padStart(2, '0');
    const dateRange = `${month} ${startDay}-${endDay}`;
    
    // Extract country/location names
    const raceName = next.meeting_name.replace(' Grand Prix', '');
    const location = next.location || next.circuit_short_name || '';
    
    // Group sessions by day
    const sessionsByDay = {};
    const dayOrder = ['FRIDAY', 'SATURDAY', 'SUNDAY', 'THURSDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY'];
    
    sessions.forEach(session => {
      const sessionDate = new Date(session.date_start);
      const dayName = sessionDate.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
      if (!sessionsByDay[dayName]) {
        sessionsByDay[dayName] = [];
      }
      sessionsByDay[dayName].push({
        name: session.session_name,
        date: sessionDate,
        dayNum: sessionDate.getDate().toString().padStart(2, '0'),
        dayAbbr: sessionDate.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
        startTime: sessionDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase(),
        endTime: session.date_end ? new Date(session.date_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase() : ''
      });
    });
    
    // Sort days by their earliest session date (ascending)
    const sortedDays = Object.keys(sessionsByDay).sort((a, b) => {
      return sessionsByDay[a][0].date - sessionsByDay[b][0].date;
    });
    
    // Build session schedule HTML
    let scheduleHTML = '';
    sortedDays.forEach(day => {
      scheduleHTML += `<div class="schedule-day">${day}</div>`;
      sessionsByDay[day].forEach(s => {
        const timeRange = s.endTime ? `${s.startTime} – ${s.endTime}` : s.startTime;
        scheduleHTML += `
          <div class="schedule-session">
            <div class="session-date">
              <span class="session-day-num">${s.dayNum}</span>
              <span class="session-day-abbr">${s.dayAbbr}</span>
            </div>
            <div class="session-details">
              <div class="session-name">${s.name}</div>
              <div class="session-time">${timeRange}</div>
            </div>
          </div>
        `;
      });
    });
    
    // If no sessions, show placeholder
    if (!scheduleHTML) {
      scheduleHTML = '<div class="no-schedule">Schedule TBA</div>';
    }
    
    content.innerHTML = `
      <div class="next-race-layout">
        <div class="race-info-column">
          ${circuitSvgUrl
            ? `<img src="${circuitSvgUrl}" alt="" class="race-circuit-small">`
            : `<div class="race-flag-large">${F1API.getCountryFlag(next.country_code)}</div>`}
          <div class="race-country">${raceName}</div>
          <div class="race-city">${location}</div>
          <div class="race-date-range">${dateRange}</div>
          <div class="countdown-vertical">
            <div class="countdown-item">
              <span class="countdown-num" id="cd-days">--</span>
              <span class="countdown-unit">Days</span>
            </div>
            <div class="countdown-item">
              <span class="countdown-num" id="cd-hours">--</span>
              <span class="countdown-unit">Hrs</span>
            </div>
            <div class="countdown-item">
              <span class="countdown-num" id="cd-mins">--</span>
              <span class="countdown-unit">Mins</span>
            </div>
          </div>
        </div>
        <div class="race-schedule-column">
          ${scheduleHTML}
        </div>
      </div>
    `;
    
    startCountdown(new Date(next.date_start));
    
  } catch (error) {
    console.error('Error loading next race:', error);
    content.innerHTML = '<div class="no-data">Failed to load</div>';
  }
}


function startCountdown(targetDate) {
  if (countdownInterval) clearInterval(countdownInterval);
  
  function update() {
    const diff = targetDate.getTime() - Date.now();
    
    if (diff <= 0) {
      ['cd-days', 'cd-hours', 'cd-mins', 'cd-secs'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '0';
      });
      return;
    }
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);
    
    const daysEl = document.getElementById('cd-days');
    const hoursEl = document.getElementById('cd-hours');
    const minsEl = document.getElementById('cd-mins');
    const secsEl = document.getElementById('cd-secs');
    
    if (daysEl) daysEl.textContent = days;
    if (hoursEl) hoursEl.textContent = String(hours).padStart(2, '0');
    if (minsEl) minsEl.textContent = String(mins).padStart(2, '0');
    if (secsEl) secsEl.textContent = String(secs).padStart(2, '0');
  }
  
  update();
  countdownInterval = setInterval(update, 1000);
}

/**
 * Render Favorite Driver Widget with Stats
 */
async function renderFavoriteDriverWidget() {
  const content = document.getElementById('favorite-driver-content');
  
  try {
    const favoriteNum = await F1Storage.loadFavoriteDriver();
    
    if (!favoriteNum) {
      content.innerHTML = `
        <div class="no-fav">
          <div class="no-fav-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
            </svg>
          </div>
          <button class="btn-select" data-action="select-driver">Select Driver</button>
        </div>
      `;
      return;
    }
    
    if (currentDrivers.length === 0) {
      currentDrivers = await F1API.getLatestDrivers();
    }
    
    // Get driver standings for stats
    if (driverStandingsData.length === 0) {
      driverStandingsData = await F1API.getDriverStandings(F1API.getActiveSeason());
    }
    
    const driver = currentDrivers.find(d => d.driver_number === favoriteNum);
    
    if (!driver) {
      content.innerHTML = '<div class="no-fav"><button class="btn-select" data-action="select-driver">Select Driver</button></div>';
      return;
    }
    
    const color = F1API.getTeamColor(driver.team_name, driver.team_colour);
    const photo = driver.headshot_url || '';
    
    // Find driver stats from standings data
    const driverStanding = driverStandingsData.find(s => 
      parseInt(s.Driver.permanentNumber) === favoriteNum || s.Driver.code === driver.name_acronym
    );
    const stats = driverStanding 
      ? { wins: parseInt(driverStanding.wins), position: parseInt(driverStanding.position), points: parseInt(driverStanding.points) }
      : { wins: 0, position: '-', points: 0 };
    
    content.innerHTML = `
      <div class="fav-content" style="--team-color: ${color}">
        <img src="${photo}" alt="" class="fav-photo" style="border-color: ${color}" data-fallback="hide">
        <div class="fav-details">
          <div class="fav-name">${driver.full_name} <span class="fav-team-inline" style="color: ${color}">/ ${driver.team_name}</span></div>
          <div class="fav-stats">
            <div class="fav-stat">
              <div class="fav-stat-value" style="color: ${color}">${stats.position}</div>
              <div class="fav-stat-label">Pos</div>
            </div>
            <div class="fav-stat">
              <div class="fav-stat-value" style="color: ${color}">${stats.wins}</div>
              <div class="fav-stat-label">Wins</div>
            </div>
            <div class="fav-stat">
              <div class="fav-stat-value" style="color: ${color}">${stats.points}</div>
              <div class="fav-stat-label">Pts</div>
            </div>
          </div>
        </div>
      </div>
    `;
    setupImageErrorHandlers(content);

  } catch (error) {
    console.error('Error loading favorite driver:', error);
    content.innerHTML = '<div class="no-fav"><button class="btn-select" data-action="select-driver">Select Driver</button></div>';
  }
}

/**
 * Render Favorite Team Widget with Stats
 */
async function renderFavoriteTeamWidget() {
  const content = document.getElementById('favorite-team-content');
  
  try {
    const favoriteTeam = await F1Storage.loadFavoriteConstructor();
    
    if (!favoriteTeam) {
      content.innerHTML = `
        <div class="no-fav">
          <div class="no-fav-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
            </svg>
          </div>
          <button class="btn-select" data-action="select-team">Select Team</button>
        </div>
      `;
      return;
    }
    
    if (currentDrivers.length === 0) {
      currentDrivers = await F1API.getLatestDrivers();
    }
    
    // Get constructor standings for stats
    if (constructorStandingsData.length === 0) {
      constructorStandingsData = await F1API.getConstructorStandings(F1API.getActiveSeason());
    }
    
    const teamDriver = currentDrivers.find(d => d.team_name === favoriteTeam);
    const color = teamDriver ? F1API.getTeamColor(teamDriver.team_name, teamDriver.team_colour) : '#888';
    
    // Find team stats from standings data - match by partial name
    const teamStanding = constructorStandingsData.find(s => 
      favoriteTeam.toLowerCase().includes(s.Constructor.name.toLowerCase()) ||
      s.Constructor.name.toLowerCase().includes(favoriteTeam.toLowerCase().split(' ')[0])
    );
    const stats = teamStanding 
      ? { wins: parseInt(teamStanding.wins), position: parseInt(teamStanding.position), points: parseInt(teamStanding.points) }
      : { wins: 0, position: '-', points: 0 };
    
    const teamLogo = F1API.getTeamLogo(favoriteTeam);
    
    content.innerHTML = `
      <div class="fav-content" style="--team-color: ${color}">
        ${teamLogo
          ? `<img src="${teamLogo}" alt="" class="fav-team-logo" style="background: ${color}" data-fallback="hide">`
          : `<div class="team-color-box" style="background: ${color}">${favoriteTeam.substring(0, 2).toUpperCase()}</div>`
        }
        <div class="fav-details">
          <div class="fav-name">${favoriteTeam}</div>
          <div class="fav-stats">
            <div class="fav-stat">
              <div class="fav-stat-value" style="color: ${color}">${stats.position}</div>
              <div class="fav-stat-label">Pos</div>
            </div>
            <div class="fav-stat">
              <div class="fav-stat-value" style="color: ${color}">${stats.wins}</div>
              <div class="fav-stat-label">Wins</div>
            </div>
            <div class="fav-stat">
              <div class="fav-stat-value" style="color: ${color}">${stats.points}</div>
              <div class="fav-stat-label">Pts</div>
            </div>
          </div>
        </div>
      </div>
    `;
    setupImageErrorHandlers(content);

  } catch (error) {
    console.error('Error loading favorite team:', error);
    content.innerHTML = '<div class="no-fav"><button class="btn-select" data-action="select-team">Select Team</button></div>';
  }
}

/**
 * Render Session Status Widget with Weather & Race Control
 */
async function renderLiveSessionWidget() {
  const content = document.getElementById('session-content');
  const liveIndicator = document.getElementById('live-indicator');

  try {
    const session = await F1API.getLatestSession();

    if (!session) {
      liveIndicator.classList.add('hidden');
      content.innerHTML = `
        <div class="session-empty">
          <svg class="session-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <div class="session-title">No Live Session</div>
          <div class="session-subtitle">Check back during race weekends</div>
        </div>
      `;
      return;
    }

    const isLive = F1API.isSessionLive(session);
    const sessionCircuitUrl = F1API.getCircuitSvgUrl(session.circuit_short_name, null, 'white-outline');

    if (isLive) {
      liveIndicator.classList.remove('hidden');
    } else {
      liveIndicator.classList.add('hidden');
    }

    // Fetch weather and race control in parallel
    let weatherData = [];
    let raceControlData = [];
    try {
      [weatherData, raceControlData] = await Promise.all([
        F1API.getWeather(session.session_key),
        F1API.getRaceControl(session.session_key),
      ]);
    } catch (e) {
      console.warn('Could not fetch session details:', e);
    }

    // Get latest weather reading
    const weather = weatherData && weatherData.length > 0
      ? weatherData[weatherData.length - 1]
      : null;

    // Get last ~6 race control messages (most recent first)
    const rcMessages = raceControlData && raceControlData.length > 0
      ? raceControlData.slice(-6).reverse()
      : [];

    // Wind direction to compass
    const windDir = weather ? degToCompass(weather.wind_direction) : '';

    // Build weather HTML
    const weatherHTML = weather ? `
      <div class="session-weather">
        <div class="weather-item">
          <span class="weather-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0Z"/></svg>
          </span>
          <span class="weather-val">${weather.air_temperature.toFixed(1)}°</span>
          <span class="weather-label">Air</span>
        </div>
        <div class="weather-item">
          <span class="weather-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0Z"/><line x1="9" y1="10" x2="14" y2="10"/></svg>
          </span>
          <span class="weather-val weather-val-hot">${weather.track_temperature.toFixed(1)}°</span>
          <span class="weather-label">Track</span>
        </div>
        <div class="weather-item">
          <span class="weather-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>
          </span>
          <span class="weather-val">${weather.humidity.toFixed(0)}%</span>
          <span class="weather-label">Humid</span>
        </div>
        <div class="weather-item">
          <span class="weather-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>
          </span>
          <span class="weather-val">${weather.wind_speed.toFixed(1)}</span>
          <span class="weather-label">${windDir}</span>
        </div>
        <div class="weather-item ${weather.rainfall > 0 ? 'weather-rain-active' : ''}">
          <span class="weather-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/></svg>
          </span>
          <span class="weather-val">${weather.rainfall > 0 ? weather.rainfall.toFixed(1) : 'Dry'}</span>
          <span class="weather-label">${weather.rainfall > 0 ? 'mm' : 'Rain'}</span>
        </div>
      </div>
    ` : '<div class="session-weather"><div class="weather-label" style="padding:8px;color:var(--text-muted)">No weather data</div></div>';

    // Build race control HTML
    const rcHTML = rcMessages.length > 0 ? rcMessages.map(msg => {
      const flagClass = getRCFlagClass(msg.flag || msg.category || '');
      const time = new Date(msg.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const text = msg.message || msg.category || '';
      return `
        <div class="rc-msg">
          <span class="rc-flag ${flagClass}"></span>
          <span class="rc-time">${time}</span>
          <span class="rc-text">${text}</span>
        </div>
      `;
    }).join('') : `
      <div class="rc-empty">No messages</div>
    `;

    content.innerHTML = `
      <div class="session-layout">
        <div class="session-left">
          ${sessionCircuitUrl
            ? `<img src="${sessionCircuitUrl}" alt="" class="session-circuit-img">`
            : `<div class="session-flag-large">${F1API.getCountryFlag(session.country_code)}</div>`}
          <div class="session-meta">
            <div class="session-title">${F1API.getCountryFlag(session.country_code)} ${session.circuit_short_name}</div>
            <div class="session-subtitle">${session.session_name}${isLive ? ' <span class="session-live-pill">LIVE</span>' : ''}</div>
          </div>
        </div>
        <div class="session-right">
          ${weatherHTML}
          <div class="session-rc">
            <div class="session-rc-label">RACE CONTROL</div>
            <div class="session-rc-feed">${rcHTML}</div>
          </div>
        </div>
      </div>
    `;

  } catch (error) {
    console.error('Error loading session:', error);
    liveIndicator.classList.add('hidden');
    content.innerHTML = '<div class="session-empty"><div class="session-title">Session Unavailable</div></div>';
  }
}

/** Convert wind degrees to compass direction */
function degToCompass(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

/** Map race control flag/category to CSS class */
function getRCFlagClass(flag) {
  const f = flag.toUpperCase();
  if (f.includes('RED')) return 'rc-red';
  if (f.includes('YELLOW')) return 'rc-yellow';
  if (f.includes('GREEN') || f.includes('CLEAR')) return 'rc-green';
  if (f.includes('CHEQUERED') || f.includes('CHECKERED')) return 'rc-chequered';
  if (f.includes('SAFETY') || f.includes('VSC')) return 'rc-safety';
  if (f.includes('BLUE')) return 'rc-blue';
  return 'rc-default';
}

/**
 * Render Driver Standings
 */
async function renderDriverStandings() {
  const content = document.getElementById('drivers-content');
  const yearEl = document.getElementById('standings-year');
  
  try {
    // Fetch both standings and driver details
    const [standings, drivers] = await Promise.all([
      F1API.getDriverStandings(F1API.getActiveSeason()),
      F1API.getLatestDrivers()
    ]);
    
    currentDrivers = drivers;
    driverStandingsData = standings;
    
    if (!standings || standings.length === 0) {
      content.innerHTML = '<div class="no-data">No driver standings data</div>';
      return;
    }
    
    yearEl.textContent = F1API.getActiveSeason();
    
    const fallbackSvg = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><rect fill=%22%23222%22 width=%2232%22 height=%2232%22/></svg>';
    
    content.innerHTML = standings.map(standing => {
      const driverCode = standing.Driver.code;
      const teamName = standing.Constructors[0]?.name || '';
      
      // Find matching driver from OpenF1 for photo and color
      const openF1Driver = drivers.find(d => d.name_acronym === driverCode);
      const color = openF1Driver ? F1API.getTeamColor(openF1Driver.team_name, openF1Driver.team_colour) : F1API.getTeamColor(teamName);
      const photo = openF1Driver?.headshot_url || '';
      
      const fullName = `${standing.Driver.givenName} ${standing.Driver.familyName}`;
      
      return `
        <div class="driver-row" style="--team-color: ${color}">
          <div class="driver-pos">${standing.position}</div>
          <img src="${photo}" alt="" class="driver-photo" data-fallback="${fallbackSvg}">
          <div class="driver-info">
            <div class="driver-name">${fullName}</div>
            <div class="driver-team">${teamName}</div>
          </div>
          <div class="points-pill" style="color: ${color}">${standing.points} pts</div>
        </div>
      `;
    }).join('');
    setupImageErrorHandlers(content);
    
  } catch (error) {
    console.error('Error loading drivers:', error);
    content.innerHTML = '<div class="no-data">Failed to load drivers</div>';
  }
}

/**
 * Render Constructor Standings
 */
async function renderConstructorStandings() {
  const content = document.getElementById('constructors-content');
  const yearEl = document.getElementById('constructors-year');
  
  try {
    // Fetch constructor standings from Jolpica API
    const standings = await F1API.getConstructorStandings(F1API.getActiveSeason());
    constructorStandingsData = standings;
    
    if (!standings || standings.length === 0) {
      content.innerHTML = '<div class="no-data">No constructor standings data</div>';
      return;
    }
    
    yearEl.textContent = F1API.getActiveSeason();
    
    // Get drivers for team colors if not already loaded
    if (currentDrivers.length === 0) {
      currentDrivers = await F1API.getLatestDrivers();
    }
    
    content.innerHTML = standings.map(standing => {
      const teamName = standing.Constructor.name;
      
      // Find a driver from this team for color
      const teamDriver = currentDrivers.find(d => 
        d.team_name.toLowerCase().includes(teamName.toLowerCase().split(' ')[0]) ||
        teamName.toLowerCase().includes(d.team_name.toLowerCase().split(' ')[0])
      );
      const color = teamDriver ? F1API.getTeamColor(teamDriver.team_name, teamDriver.team_colour) : F1API.getTeamColor(teamName);
      const teamLogo = F1API.getTeamLogo(teamDriver?.team_name || teamName);
      
      // Get driver codes for this team
      const teamDrivers = currentDrivers.filter(d => 
        d.team_name.toLowerCase().includes(teamName.toLowerCase().split(' ')[0]) ||
        teamName.toLowerCase().includes(d.team_name.toLowerCase().split(' ')[0])
      );
      const driverCodes = [...new Set(teamDrivers.map(d => d.name_acronym))].join(' / ') || '-';
      
      return `
        <div class="constructor-row" style="--team-color: ${color}">
          <div class="constructor-pos">${standing.position}</div>
          ${teamLogo 
            ? `<img src="${teamLogo}" alt="" class="constructor-logo" style="background: ${color}" data-fallback="hide">` 
            : `<div class="constructor-color" style="background: ${color}"></div>`
          }
          <div class="constructor-info">
            <div class="constructor-name">${teamName}</div>
            <div class="constructor-drivers">${driverCodes}</div>
          </div>
          <div class="points-pill" style="color: ${color}">${standing.points} pts</div>
        </div>
      `;
    }).join('');
    setupImageErrorHandlers(content);
    
  } catch (error) {
    console.error('Error loading constructors:', error);
    content.innerHTML = '<div class="no-data">Failed to load teams</div>';
  }
}

/**
 * Render Race Calendar
 */
async function renderCalendarWidget() {
  const content = document.getElementById('calendar-content');
  const yearEl = document.getElementById('calendar-year');
  
  try {
    const year = F1API.getActiveSeason();
    const meetings = currentMeetings.length > 0 ? currentMeetings : await F1API.getMeetings(year);
    yearEl.textContent = year;
    
    if (!meetings || meetings.length === 0) {
      content.innerHTML = '<div class="no-data">No calendar data</div>';
      return;
    }
    
    const now = new Date();
    const sorted = [...meetings].sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
    const nextIdx = sorted.findIndex(m => new Date(m.date_start) > now);
    const hasOngoing = sorted.some(m => {
      const start = new Date(m.date_start);
      const end = m.date_end ? new Date(m.date_end) : new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);
      return now >= start && now <= end;
    });

    content.innerHTML = sorted.map((m, i) => {
      const flag = F1API.getCountryFlag(m.country_code);
      const date = new Date(m.date_start);
      const dateStr = date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
      
      let badgeClass = 'upcoming';
      let badgeText = 'Upcoming';
      let rowClass = '';

      const meetingStart = new Date(m.date_start);
      const meetingEnd = m.date_end ? new Date(m.date_end) : new Date(meetingStart.getTime() + 3 * 24 * 60 * 60 * 1000);

      if (now >= meetingStart && now <= meetingEnd) {
        badgeClass = 'ongoing';
        badgeText = 'On-Going';
        rowClass = 'is-ongoing';
      } else if (i < nextIdx || (nextIdx === -1)) {
        badgeClass = 'done';
        badgeText = 'Done';
        rowClass = 'is-completed';
      } else if (i === nextIdx && !hasOngoing) {
        badgeClass = 'next';
        badgeText = 'Next';
        rowClass = 'is-next';
      }
      
      return `
        <div class="calendar-row ${rowClass}">
          <div class="calendar-round">${i + 1}</div>
          <div class="calendar-flag">${flag}</div>
          <div class="calendar-info">
            <div class="calendar-name">${m.meeting_name.replace(' Grand Prix', ' GP')}</div>
            <div class="calendar-date">${dateStr}</div>
          </div>
          <div class="calendar-badge ${badgeClass}">${badgeText}</div>
        </div>
      `;
    }).join('');
    
  } catch (error) {
    console.error('Error loading calendar:', error);
    content.innerHTML = '<div class="no-data">Failed to load calendar</div>';
  }
}

/**
 * Open Driver Selection Modal
 */
async function openDriverSelect() {
  const modal = document.getElementById('driver-select-modal');
  const grid = document.getElementById('driver-grid');
  
  modal.classList.add('active');
  
  try {
    if (currentDrivers.length === 0) {
      currentDrivers = await F1API.getLatestDrivers();
    }
    
    const unique = [...new Map(currentDrivers.map(d => [d.driver_number, d])).values()];
    const favorite = await F1Storage.loadFavoriteDriver();
    
    grid.innerHTML = unique.map(d => {
      const color = F1API.getTeamColor(d.team_name, d.team_colour);
      const photo = d.headshot_url || '';
      const selected = d.driver_number === favorite ? 'selected' : '';
      
      return `
        <div class="driver-pick-card ${selected}" style="--team-color: ${color}" data-driver="${d.driver_number}">
          <img src="${photo}" alt="" class="driver-pick-photo" style="border-color: ${color}" data-fallback="hide">
          <div class="driver-pick-name">${d.full_name}</div>
          <div class="driver-pick-team">${d.team_name}</div>
        </div>
      `;
    }).join('');
    setupImageErrorHandlers(grid);
    
  } catch (error) {
    console.error('Error loading drivers for selection:', error);
    grid.innerHTML = '<div class="no-data">Failed to load drivers</div>';
  }
}

function closeDriverSelect() {
  document.getElementById('driver-select-modal').classList.remove('active');
}

async function selectDriver(num) {
  await F1Storage.saveFavoriteDriver(num);
  closeDriverSelect();
  await renderFavoriteDriverWidget();
}

/**
 * Open Team Selection Modal
 */
async function openTeamSelect() {
  const modal = document.getElementById('team-select-modal');
  const grid = document.getElementById('team-grid');
  
  modal.classList.add('active');
  
  try {
    if (currentDrivers.length === 0) {
      currentDrivers = await F1API.getLatestDrivers();
    }
    
    const teams = {};
    currentDrivers.forEach(d => {
      if (!teams[d.team_name]) {
        teams[d.team_name] = {
          name: d.team_name,
          color: F1API.getTeamColor(d.team_name, d.team_colour)
        };
      }
    });
    
    const teamList = Object.values(teams).sort((a, b) => a.name.localeCompare(b.name));
    const favorite = await F1Storage.loadFavoriteConstructor();
    
    grid.innerHTML = teamList.map(t => {
      const selected = t.name === favorite ? 'selected' : '';
      const logo = F1API.getTeamLogo(t.name);
      
      return `
        <div class="team-pick-card ${selected}" data-team="${t.name}" style="--team-color: ${t.color}">
          ${logo 
            ? `<img src="${logo}" alt="" class="team-pick-logo" style="background: ${t.color}" data-fallback="hide">` 
            : `<div class="team-pick-color" style="background: ${t.color}"></div>`
          }
          <div class="team-pick-name">${t.name}</div>
        </div>
      `;
    }).join('');
    setupImageErrorHandlers(grid);
    
  } catch (error) {
    console.error('Error loading teams for selection:', error);
    grid.innerHTML = '<div class="no-data">Failed to load teams</div>';
  }
}

function closeTeamSelect() {
  document.getElementById('team-select-modal').classList.remove('active');
}

async function selectTeam(name) {
  await F1Storage.saveFavoriteConstructor(name);
  closeTeamSelect();
  await renderFavoriteTeamWidget();
}

/**
 * Render Live Standings Widget (top 5) with "View All" modal
 */
let lastPositionsData = []; // store for modal reuse

async function renderLiveStandingsWidget() {
  const content = document.getElementById('live-standings-content');

  try {
    const session = await F1API.getLatestSession();

    if (!session) {
      content.innerHTML = '<div class="no-data">No session data</div>';
      return;
    }

    if (currentDrivers.length === 0) {
      currentDrivers = await F1API.getLatestDrivers();
    }

    // Fetch positions, intervals, and laps in parallel
    const [positions, intervals, laps] = await Promise.all([
      F1API.getPositions(session.session_key),
      F1API.getIntervals(session.session_key).catch(() => []),
      F1API.getLaps(session.session_key).catch(() => []),
    ]);

    if (!positions || positions.length === 0) {
      content.innerHTML = '<div class="no-data">No position data</div>';
      return;
    }

    // Get latest position per driver
    const latestPositions = {};
    positions.forEach(p => {
      latestPositions[p.driver_number] = p;
    });

    // Get latest interval per driver (race sessions only)
    const latestIntervals = {};
    if (intervals && intervals.length > 0) {
      intervals.forEach(iv => {
        latestIntervals[iv.driver_number] = iv;
      });
    }

    // Get best lap and last lap per driver
    const bestLaps = {};
    const lastLaps = {};
    if (laps && laps.length > 0) {
      laps.forEach(lap => {
        if (lap.lap_duration !== null && lap.lap_duration !== undefined) {
          if (!bestLaps[lap.driver_number] || lap.lap_duration < bestLaps[lap.driver_number]) {
            bestLaps[lap.driver_number] = lap.lap_duration;
          }
          // Track last lap (laps come chronologically, so last write wins)
          lastLaps[lap.driver_number] = lap.lap_duration;
        }
      });
    }

    const hasIntervals = Object.keys(latestIntervals).length > 0;
    const hasBestLaps = Object.keys(bestLaps).length > 0;

    // Find fastest lap across all drivers for gap calculation
    const fastestLap = hasBestLaps ? Math.min(...Object.values(bestLaps)) : null;

    // Sort by position
    const sorted = Object.values(latestPositions)
      .sort((a, b) => a.position - b.position);

    lastPositionsData = sorted.map(p => {
      const driver = currentDrivers.find(d => d.driver_number === p.driver_number);
      const iv = latestIntervals[p.driver_number];
      const best = bestLaps[p.driver_number];
      const last = lastLaps[p.driver_number];

      // Race: interval to car ahead. Practice/Qual: fastest lap + delta to P1.
      let interval = '';
      let bestLapStr = best ? formatLapTime(best) : '';
      let delta = '';

      if (hasIntervals) {
        // Race mode
        if (p.position === 1) {
          interval = 'LEADER';
        } else if (iv) {
          interval = formatInterval(iv.interval) || formatInterval(iv.gap_to_leader);
        }
      } else if (hasBestLaps) {
        // Practice/Qualifying mode
        if (p.position === 1) {
          delta = '-';
        } else if (best && fastestLap) {
          const gap = best - fastestLap;
          delta = gap > 0 ? `+${gap.toFixed(3)}s` : '-';
        }
      }

      return {
        position: p.position,
        driverNumber: p.driver_number,
        code: driver?.name_acronym || `#${p.driver_number}`,
        fullName: driver?.full_name || `Driver ${p.driver_number}`,
        teamName: driver?.team_name || '',
        color: driver ? F1API.getTeamColor(driver.team_name, driver.team_colour) : '#888',
        photo: driver?.headshot_url || '',
        interval,
        bestLap: bestLapStr,
        delta,
      };
    });

    // Render top 5 — different columns for race vs practice/quali
    const top5 = lastPositionsData.slice(0, 5);

    if (hasIntervals) {
      // Race: P | Driver | Interval
      content.innerHTML = `
        <div class="ls-header">
          <div class="ls-pos">P</div>
          <div class="ls-code">Driver</div>
          <div class="ls-interval">Interval</div>
        </div>
      ` + top5.map(d => `
        <div class="ls-row" style="--team-color: ${d.color}">
          <div class="ls-pos">${d.position}</div>
          <div class="ls-code">${d.code}</div>
          <div class="ls-interval">${d.interval}</div>
        </div>
      `).join('') + `<button class="btn-link ls-view-all" data-action="view-all-standings">View All</button>`;
    } else {
      // Practice/Qualifying: P | Driver | Fastest Lap | Delta
      content.innerHTML = `
        <div class="ls-header">
          <div class="ls-pos">P</div>
          <div class="ls-code">Driver</div>
          <div class="ls-lap">Fastest</div>
          <div class="ls-interval">Delta</div>
        </div>
      ` + top5.map(d => `
        <div class="ls-row" style="--team-color: ${d.color}">
          <div class="ls-pos">${d.position}</div>
          <div class="ls-code">${d.code}</div>
          <div class="ls-lap">${d.bestLap}</div>
          <div class="ls-interval">${d.delta}</div>
        </div>
      `).join('') + `<button class="btn-link ls-view-all" data-action="view-all-standings">View All</button>`;
    }

  } catch (error) {
    console.error('Error loading live standings:', error);
    content.innerHTML = '<div class="no-data">Failed to load</div>';
  }
}

function formatInterval(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return `+${val.toFixed(3)}s`;
  return String(val);
}

function formatLapTime(seconds) {
  if (!seconds && seconds !== 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3);
  return mins > 0 ? `${mins}:${secs.padStart(6, '0')}` : `${secs}s`;
}

function openLiveStandingsModal() {
  const modal = document.getElementById('live-standings-modal');
  const grid = document.getElementById('live-standings-full');
  modal.classList.add('active');

  const fallbackSvg = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><rect fill=%22%23222%22 width=%2232%22 height=%2232%22/></svg>';

  if (lastPositionsData.length === 0) {
    grid.innerHTML = '<div class="no-data">No data available</div>';
    return;
  }

  // Determine mode from data: if any driver has an interval, it's a race
  const isRace = lastPositionsData.some(d => d.interval);

  if (isRace) {
    // Race: P | Driver | Interval
    grid.innerHTML = `
      <div class="ls-header ls-modal-header">
        <div class="ls-pos">P</div>
        <div class="ls-driver-col">Driver</div>
        <div class="ls-interval">Interval</div>
      </div>
    ` + lastPositionsData.map(d => `
      <div class="ls-row ls-modal-row" style="--team-color: ${d.color}">
        <div class="ls-pos">${d.position}</div>
        <div class="ls-driver-col">
          <img src="${d.photo}" alt="" class="ls-photo" data-fallback="${fallbackSvg}">
          <div class="ls-driver-info">
            <div class="ls-driver-name">${d.fullName}</div>
            <div class="ls-driver-team">${d.teamName}</div>
          </div>
        </div>
        <div class="ls-interval">${d.interval || '-'}</div>
      </div>
    `).join('');
  } else {
    // Practice/Qualifying: P | Driver | Fastest Lap | Delta
    grid.innerHTML = `
      <div class="ls-header ls-modal-header">
        <div class="ls-pos">P</div>
        <div class="ls-driver-col">Driver</div>
        <div class="ls-lap">Fastest Lap</div>
        <div class="ls-interval">Delta</div>
      </div>
    ` + lastPositionsData.map(d => `
      <div class="ls-row ls-modal-row" style="--team-color: ${d.color}">
        <div class="ls-pos">${d.position}</div>
        <div class="ls-driver-col">
          <img src="${d.photo}" alt="" class="ls-photo" data-fallback="${fallbackSvg}">
          <div class="ls-driver-info">
            <div class="ls-driver-name">${d.fullName}</div>
            <div class="ls-driver-team">${d.teamName}</div>
          </div>
        </div>
        <div class="ls-lap">${d.bestLap || '-'}</div>
        <div class="ls-interval">${d.delta || '-'}</div>
      </div>
    `).join('');
  }
  setupImageErrorHandlers(grid);
}

function closeLiveStandingsModal() {
  document.getElementById('live-standings-modal').classList.remove('active');
}

// Export functions
window.renderNextRaceWidget = renderNextRaceWidget;
window.renderFavoriteDriverWidget = renderFavoriteDriverWidget;
window.renderFavoriteTeamWidget = renderFavoriteTeamWidget;
window.renderLiveSessionWidget = renderLiveSessionWidget;
window.renderLiveStandingsWidget = renderLiveStandingsWidget;
window.renderDriverStandings = renderDriverStandings;
window.renderConstructorStandings = renderConstructorStandings;
window.renderCalendarWidget = renderCalendarWidget;
window.openDriverSelect = openDriverSelect;
window.closeDriverSelect = closeDriverSelect;
window.selectDriver = selectDriver;
window.openTeamSelect = openTeamSelect;
window.closeTeamSelect = closeTeamSelect;
window.selectTeam = selectTeam;
window.openLiveStandingsModal = openLiveStandingsModal;
window.closeLiveStandingsModal = closeLiveStandingsModal;
