/**
 * F1 Dashboard - Main Application
 * CSP compliant - using event delegation instead of inline handlers
 */

async function initDashboard() {
  console.log('🏎️ F1 Dashboard starting...');
  updateStatus('Loading...');
  
  // Determine active season first
  await F1API.determineActiveSeason();

  // Set up all event listeners first
  setupEventListeners();

  // Autofocus search bar
  document.getElementById('search-input').focus();

  // Start clock
  updateClock();
  setInterval(updateClock, 1000);
  
  try {
    await Promise.all([
      renderNextRaceWidget(),
      renderFavoriteDriverWidget(),
      renderFavoriteTeamWidget(),
      renderLiveSessionWidget(),
      renderDriverStandings(),
      renderConstructorStandings(),
      renderCalendarWidget(),
      populateSettings(),
    ]);
    
    updateStatus();
    console.log('✅ Dashboard ready');
    
  } catch (error) {
    console.error('Dashboard init error:', error);
    updateStatus('Error loading');
  }
  
  // Auto-refresh every 5 mins
  setInterval(refreshDashboard, 5 * 60 * 1000);
}

function setupEventListeners() {
  // Settings button
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  
  // Change buttons in widget headers
  document.getElementById('change-driver-btn').addEventListener('click', openDriverSelect);
  document.getElementById('change-team-btn').addEventListener('click', openTeamSelect);
  
  // Save settings button
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  
  // Close buttons (using data-close attribute)
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', function() {
      const target = this.getAttribute('data-close');
      if (target === 'settings') closeSettings();
      if (target === 'driver-select') closeDriverSelect();
      if (target === 'team-select') closeTeamSelect();
    });
  });
  
  // Search bar
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const query = e.target.value.trim();
      if (query) {
        chrome.runtime.sendMessage({ type: 'search', query });
      }
    }
  });

  // Escape key to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettings();
      closeDriverSelect();
      closeTeamSelect();
    }
  });
  
  // Event delegation for dynamic content
  document.addEventListener('click', async (e) => {
    // Select driver button in widget
    if (e.target.matches('[data-action="select-driver"]')) {
      openDriverSelect();
      return;
    }
    
    // Select team button in widget
    if (e.target.matches('[data-action="select-team"]')) {
      openTeamSelect();
      return;
    }
    
    // Driver card in selection modal
    const driverCard = e.target.closest('[data-driver]');
    if (driverCard) {
      const driverNum = parseInt(driverCard.getAttribute('data-driver'));
      await selectDriver(driverNum);
      return;
    }
    
    // Team card in selection modal
    const teamCard = e.target.closest('[data-team]');
    if (teamCard) {
      const teamName = teamCard.getAttribute('data-team');
      await selectTeam(teamName);
      return;
    }
  });
}

function updateStatus(msg) {
  const el = document.getElementById('last-updated');
  if (msg) {
    el.textContent = msg;
  } else {
    const now = new Date();
    el.textContent = `Updated ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

async function refreshDashboard() {
  console.log('🔄 Refreshing...');
  try {
    await Promise.all([
      renderNextRaceWidget(),
      renderLiveSessionWidget(),
      renderDriverStandings(),
      renderConstructorStandings(),
    ]);
    updateStatus();
  } catch (e) {
    console.error('Refresh error:', e);
  }
}

function openSettings() {
  document.getElementById('settings-modal').classList.add('active');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('active');
}

async function populateSettings() {
  const driverSel = document.getElementById('favorite-driver-select');
  const teamSel = document.getElementById('favorite-constructor-select');
  
  try {
    const drivers = await F1API.getLatestDrivers();
    const unique = [...new Map(drivers.map(d => [d.driver_number, d])).values()];
    const favDriver = await F1Storage.loadFavoriteDriver();
    const favTeam = await F1Storage.loadFavoriteConstructor();
    
    // Clear existing options except first
    driverSel.innerHTML = '<option value="">Select driver...</option>';
    teamSel.innerHTML = '<option value="">Select team...</option>';
    
    unique.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.driver_number;
      opt.textContent = `${d.full_name} (${d.team_name})`;
      if (d.driver_number === favDriver) opt.selected = true;
      driverSel.appendChild(opt);
    });
    
    const teams = [...new Set(drivers.map(d => d.team_name))].sort();
    teams.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === favTeam) opt.selected = true;
      teamSel.appendChild(opt);
    });
    
  } catch (e) {
    console.error('Settings populate error:', e);
  }
}

async function saveSettings() {
  const driverVal = document.getElementById('favorite-driver-select').value;
  const teamVal = document.getElementById('favorite-constructor-select').value;
  
  console.log('Saving settings:', driverVal, teamVal);
  
  await F1Storage.saveFavoriteDriver(driverVal ? parseInt(driverVal) : null);
  await F1Storage.saveFavoriteConstructor(teamVal || null);
  
  closeSettings();
  
  await renderFavoriteDriverWidget();
  await renderFavoriteTeamWidget();
}

function updateClock() {
  const now = new Date();
  document.getElementById('clock-time').textContent = now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit'
  });
  document.getElementById('clock-date').textContent = now.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initDashboard);
