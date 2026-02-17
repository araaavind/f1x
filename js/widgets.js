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
    const circuitSvgUrl = F1API.getCircuitSvgUrl(next.circuit_short_name, next.meeting_name);
    
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
            <div class="fav-stat-label">Points</div>
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
            <div class="fav-stat-label">Points</div>
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
 * Render Session Status Widget
 */
async function renderLiveSessionWidget() {
  const content = document.getElementById('session-content');
  const liveIndicator = document.getElementById('live-indicator');
  
  try {
    const session = await F1API.getLatestSession();
    
    if (!session) {
      liveIndicator.classList.add('hidden');
      content.innerHTML = `
        <div class="session-content" style="flex-direction: column">
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

    content.innerHTML = `
      <div class="session-content">
        ${sessionCircuitUrl
          ? `<img src="${sessionCircuitUrl}" alt="" class="session-circuit-bg">`
          : `<div style="font-size: 48px; opacity: 0.7">${F1API.getCountryFlag(session.country_code)}</div>`}
        <div class="session-info">
          <div class="session-title">${getCountryFlag(session.country_code)} ${session.circuit_short_name}</div>
          <div class="session-subtitle">${session.session_name}${isLive ? ' • LIVE' : ''}</div>
        </div>
      </div>
    `;
    
  } catch (error) {
    console.error('Error loading session:', error);
    liveIndicator.classList.add('hidden');
    content.innerHTML = '<div class="session-content"><div class="session-title">Session Unavailable</div></div>';
  }
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

// Export functions
window.renderNextRaceWidget = renderNextRaceWidget;
window.renderFavoriteDriverWidget = renderFavoriteDriverWidget;
window.renderFavoriteTeamWidget = renderFavoriteTeamWidget;
window.renderLiveSessionWidget = renderLiveSessionWidget;
window.renderDriverStandings = renderDriverStandings;
window.renderConstructorStandings = renderConstructorStandings;
window.renderCalendarWidget = renderCalendarWidget;
window.openDriverSelect = openDriverSelect;
window.closeDriverSelect = closeDriverSelect;
window.selectDriver = selectDriver;
window.openTeamSelect = openTeamSelect;
window.closeTeamSelect = closeTeamSelect;
window.selectTeam = selectTeam;
