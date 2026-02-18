/**
 * F1 Dashboard - Main Application
 * CSP compliant - using event delegation instead of inline handlers
 */

// Track pending wallpaper state within settings modal
let pendingWallpaperData = null;
let pendingWallpaperType = null;

async function initDashboard() {
  console.log('🏎️ F1 Dashboard starting...');
  updateStatus('Loading...');
  
  // Determine active season first
  await F1API.determineActiveSeason();

  // Set up all event listeners first
  setupEventListeners();

  // Restore wallpaper before anything renders
  await restoreWallpaper();

  // Initialize GridStack layout
  await F1Grid.init();

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
      renderLiveStandingsWidget(),
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

  // Edit layout toggle
  document.getElementById('edit-layout-btn').addEventListener('click', () => {
    F1Grid.toggleEditMode();
  });

  // Available Widgets button (navbar, edit mode)
  document.getElementById('available-widgets-btn').addEventListener('click', () => {
    F1Grid.openAvailableWidgetsModal();
  });

  // Reset layout button (navbar, edit mode)
  document.getElementById('reset-layout-navbar-btn').addEventListener('click', () => {
    if (confirm('Reset widget layout to defaults?')) {
      F1Grid.resetLayout();
    }
  });

  // Done editing button (navbar, edit mode)
  document.getElementById('done-editing-btn').addEventListener('click', () => {
    F1Grid.toggleEditMode();
  });

  // Close buttons (using data-close attribute)
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', function() {
      const target = this.getAttribute('data-close');
      if (target === 'settings') closeSettings();
      if (target === 'driver-select') closeDriverSelect();
      if (target === 'team-select') closeTeamSelect();
      if (target === 'live-standings') closeLiveStandingsModal();
      if (target === 'available-widgets') F1Grid.closeAvailableWidgetsModal();
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
      closeLiveStandingsModal();
      F1Grid.closeAvailableWidgetsModal();
    }
  });
  
  // Event delegation for dynamic content
  document.addEventListener('click', async (e) => {
    // View all live standings button
    if (e.target.closest('[data-action="view-all-standings"]')) {
      openLiveStandingsModal();
      return;
    }

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
    
    // Remove widget button (edit mode)
    const removeBtn = e.target.closest('[data-remove-widget]');
    if (removeBtn) {
      F1Grid.removeWidget(removeBtn.getAttribute('data-remove-widget'));
      return;
    }

    // Restore widget button (add-widget panel)
    const restoreBtn = e.target.closest('[data-restore-widget]');
    if (restoreBtn) {
      await F1Grid.restoreWidget(restoreBtn.getAttribute('data-restore-widget'));
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

  // ===== WALLPAPER / THEME SETTINGS =====
  setupWallpaperListeners();
}

function setupWallpaperListeners() {
  // Theme toggle buttons
  const themeToggle = document.getElementById('theme-toggle');
  themeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme]');
    if (!btn) return;
    
    const theme = btn.getAttribute('data-theme');
    themeToggle.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const wallpaperOptions = document.getElementById('wallpaper-options');
    if (theme === 'wallpaper') {
      wallpaperOptions.classList.add('visible');
    } else {
      wallpaperOptions.classList.remove('visible');
    }
  });

  // File upload zone - click
  const uploadZone = document.getElementById('file-upload-zone');
  const fileInput = document.getElementById('wallpaper-file-input');
  
  uploadZone.addEventListener('click', () => fileInput.click());

  // File input change
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileUpload(file);
  });

  // Drag and drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFileUpload(file);
    }
  });

  // URL input - load preview on blur or Enter
  const urlInput = document.getElementById('wallpaper-url-input');
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleUrlInput(urlInput.value.trim());
    }
  });
  urlInput.addEventListener('blur', () => {
    const url = urlInput.value.trim();
    if (url) handleUrlInput(url);
  });

  // Remove wallpaper button
  document.getElementById('wallpaper-remove-btn').addEventListener('click', () => {
    clearPendingWallpaper();
  });
}

function handleFileUpload(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result;
    pendingWallpaperData = base64;
    pendingWallpaperType = 'file';
    showWallpaperPreview(base64);
    // Clear URL input since file was chosen
    document.getElementById('wallpaper-url-input').value = '';
  };
  reader.readAsDataURL(file);
}

function handleUrlInput(url) {
  if (!url) return;
  pendingWallpaperData = url;
  pendingWallpaperType = 'url';
  showWallpaperPreview(url);
}

function showWallpaperPreview(src) {
  const preview = document.getElementById('wallpaper-preview');
  const previewImg = document.getElementById('wallpaper-preview-img');
  previewImg.src = src;
  preview.classList.add('visible');
}

function clearPendingWallpaper() {
  pendingWallpaperData = null;
  pendingWallpaperType = null;
  const preview = document.getElementById('wallpaper-preview');
  preview.classList.remove('visible');
  document.getElementById('wallpaper-preview-img').src = '';
  document.getElementById('wallpaper-url-input').value = '';
  document.getElementById('wallpaper-file-input').value = '';
}

function applyWallpaper(imageData) {
  const wallpaperEl = document.querySelector('.bg-wallpaper');
  if (wallpaperEl) {
    wallpaperEl.style.backgroundImage = `url('${imageData}')`;
  }
  document.body.classList.add('wallpaper-mode');
}

function removeWallpaper() {
  document.body.classList.remove('wallpaper-mode');
  const wallpaperEl = document.querySelector('.bg-wallpaper');
  if (wallpaperEl) {
    wallpaperEl.style.backgroundImage = 'none';
  }
}

async function restoreWallpaper() {
  try {
    const themeMode = await F1Storage.loadThemeMode();
    if (themeMode === 'wallpaper') {
      const { data } = await F1Storage.loadWallpaper();
      if (data) {
        applyWallpaper(data);
      }
    }
  } catch (e) {
    console.error('Failed to restore wallpaper:', e);
  }
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
      renderLiveStandingsWidget(),
      renderDriverStandings(),
      renderConstructorStandings(),
    ]);
    updateStatus();
  } catch (e) {
    console.error('Refresh error:', e);
  }
}

function openSettings() {
  // Sync UI state with current settings before opening
  syncSettingsUI();
  document.getElementById('settings-modal').classList.add('active');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('active');
}

async function syncSettingsUI() {
  const themeMode = await F1Storage.loadThemeMode();
  const themeToggle = document.getElementById('theme-toggle');
  themeToggle.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-theme') === themeMode);
  });

  const wallpaperOptions = document.getElementById('wallpaper-options');
  if (themeMode === 'wallpaper') {
    wallpaperOptions.classList.add('visible');
    // Load existing wallpaper preview
    const { data, type } = await F1Storage.loadWallpaper();
    if (data) {
      pendingWallpaperData = data;
      pendingWallpaperType = type;
      showWallpaperPreview(data);
      if (type === 'url') {
        document.getElementById('wallpaper-url-input').value = data;
      }
    } else {
      clearPendingWallpaper();
    }
  } else {
    wallpaperOptions.classList.remove('visible');
    clearPendingWallpaper();
  }
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

  // Save theme settings
  const activeTheme = document.querySelector('.theme-option.active');
  const themeMode = activeTheme ? activeTheme.getAttribute('data-theme') : 'default';
  await F1Storage.saveThemeMode(themeMode);

  if (themeMode === 'wallpaper' && pendingWallpaperData) {
    await F1Storage.saveWallpaper(pendingWallpaperData, pendingWallpaperType);
    applyWallpaper(pendingWallpaperData);
  } else if (themeMode === 'wallpaper' && !pendingWallpaperData) {
    // Wallpaper mode selected but no image — clear and revert
    await F1Storage.clearWallpaper();
    removeWallpaper();
  } else {
    // Default theme
    await F1Storage.clearWallpaper();
    removeWallpaper();
  }
  
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
