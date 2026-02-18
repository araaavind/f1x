/**
 * F1 Dashboard - Grid Manager
 * Handles GridStack initialization, edit mode, layout persistence
 */

const STORAGE_KEY_LAYOUT = 'f1_widget_layout';

const WIDGET_REGISTRY = {
  'live-session-widget':          { label: 'Session',       description: 'Live session info with weather and race control messages', renders: ['renderLiveSessionWidget'] },
  'live-standings-widget':        { label: 'Live Standings', description: 'Real-time driver positions during a live session', renders: ['renderLiveStandingsWidget'] },
  'favorites-widget':             { label: 'My Favorites',  description: 'Your favorite driver and team stats at a glance', renders: ['renderFavoriteDriverWidget', 'renderFavoriteTeamWidget'] },
  'driver-standings-widget':      { label: 'Drivers',       description: 'Current season driver championship standings', renders: ['renderDriverStandings'] },
  'constructor-standings-widget': { label: 'Constructors',  description: 'Current season constructor championship standings', renders: ['renderConstructorStandings'] },
  'calendar-widget':              { label: 'Calendar',      description: 'Full race calendar with upcoming and completed events', renders: ['renderCalendarWidget'] },
  'next-race-widget':             { label: 'Next Race',     description: 'Countdown and schedule for the next Grand Prix', renders: ['renderNextRaceWidget'] },
};

const DEFAULT_LAYOUT = [
  { id: 'live-session-widget',          x: 0, y: 0, w: 13, h: 4, visible: true },
  { id: 'live-standings-widget',        x: 13, y: 0, w: 6, h: 4, visible: true },
  { id: 'favorites-widget',             x: 19, y: 0, w: 5, h: 4, visible: true },
  { id: 'driver-standings-widget',      x: 0, y: 4, w: 6, h: 6, visible: true },
  { id: 'constructor-standings-widget', x: 6, y: 4, w: 6, h: 6, visible: true },
  { id: 'calendar-widget',              x: 12, y: 4, w: 6, h: 6, visible: true },
  { id: 'next-race-widget',             x: 18, y: 4, w: 6, h: 6, visible: true },
];

let grid = null;
let editMode = false;
let hiddenWidgets = []; // IDs of widgets removed by user

async function initGridManager() {
  // Load saved layout before initializing GridStack
  const saved = await loadLayout();

  // Apply saved positions to DOM attributes before GridStack reads them
  if (saved) {
    saved.forEach(item => {
      const el = document.querySelector(`.grid-stack-item[gs-id="${item.id}"]`);
      if (!el) return;
      el.setAttribute('gs-x', item.x);
      el.setAttribute('gs-y', item.y);
      el.setAttribute('gs-w', item.w);
      el.setAttribute('gs-h', item.h);
      if (!item.visible) {
        el.style.display = 'none';
        el.classList.add('widget-hidden');
        hiddenWidgets.push(item.id);
      }
    });
  }

  grid = GridStack.init({
    column: 24,
    cellHeight: 68,
    margin: 7,
    animate: true,
    float: false,
    staticGrid: true,
  }, '#widget-grid');

  // Remove hidden widgets from the grid (after init so GridStack knows about them)
  hiddenWidgets.forEach(id => {
    const el = document.querySelector(`.grid-stack-item[gs-id="${id}"]`);
    if (el) {
      grid.removeWidget(el, false);
    }
  });

  // Auto-save on layout change
  grid.on('change', () => {
    if (editMode) saveCurrentLayout();
  });
}

async function loadLayout() {
  const raw = await F1Storage.loadFromStorage(STORAGE_KEY_LAYOUT, null);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function saveCurrentLayout() {
  const items = grid.getGridItems().map(el => ({
    id: el.getAttribute('gs-id'),
    x: parseInt(el.getAttribute('gs-x')) || 0,
    y: parseInt(el.getAttribute('gs-y')) || 0,
    w: parseInt(el.getAttribute('gs-w')) || 3,
    h: parseInt(el.getAttribute('gs-h')) || 4,
    visible: true,
  }));

  // Include hidden widgets
  hiddenWidgets.forEach(id => {
    const def = DEFAULT_LAYOUT.find(d => d.id === id);
    if (def) {
      items.push({ id, x: def.x, y: def.y, w: def.w, h: def.h, visible: false });
    }
  });

  F1Storage.saveToStorage(STORAGE_KEY_LAYOUT, items);
}

function toggleEditMode() {
  editMode = !editMode;
  const btn = document.getElementById('edit-layout-btn');
  const availBtn = document.getElementById('available-widgets-btn');
  const resetBtn = document.getElementById('reset-layout-navbar-btn');
  const doneBtn = document.getElementById('done-editing-btn');
  const clock = document.getElementById('clock');
  const settingsBtn = document.getElementById('settings-btn');

  if (editMode) {
    grid.setStatic(false);
    document.body.classList.add('grid-edit-mode');
    btn.classList.add('active');
    availBtn.classList.remove('hidden');
    resetBtn.classList.remove('hidden');
    doneBtn.classList.remove('hidden');
    clock.classList.add('hidden');
    settingsBtn.classList.add('hidden');
    addRemoveButtons();
  } else {
    grid.setStatic(true);
    document.body.classList.remove('grid-edit-mode');
    btn.classList.remove('active');
    availBtn.classList.add('hidden');
    resetBtn.classList.add('hidden');
    doneBtn.classList.add('hidden');
    clock.classList.remove('hidden');
    settingsBtn.classList.remove('hidden');
    removeRemoveButtons();
    saveCurrentLayout();
    closeAvailableWidgetsModal();
  }
}

function addRemoveButtons() {
  grid.getGridItems().forEach(el => {
    const widgetId = el.getAttribute('gs-id');
    const content = el.querySelector('.grid-stack-item-content');
    if (!content || content.querySelector('.widget-remove-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'widget-remove-btn';
    btn.title = 'Remove widget';
    btn.setAttribute('data-remove-widget', widgetId);
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>';
    content.appendChild(btn);
  });
}

function removeRemoveButtons() {
  document.querySelectorAll('.widget-remove-btn').forEach(btn => btn.remove());
}

function removeWidget(widgetId) {
  const el = grid.getGridItems().find(
    el => el.getAttribute('gs-id') === widgetId
  );
  if (!el) return;

  grid.removeWidget(el, false);
  el.style.display = 'none';
  el.classList.add('widget-hidden');
  hiddenWidgets.push(widgetId);

  saveCurrentLayout();
  // Refresh modal if open
  if (document.getElementById('available-widgets-modal').classList.contains('active')) {
    openAvailableWidgetsModal();
  }
}

async function restoreWidget(widgetId) {
  const el = document.querySelector(`.grid-stack-item[gs-id="${widgetId}"]`);
  if (!el) return;

  // Remove from hidden list
  hiddenWidgets = hiddenWidgets.filter(id => id !== widgetId);

  el.classList.remove('widget-hidden');
  el.style.display = '';

  // Find position to restore to
  const def = DEFAULT_LAYOUT.find(d => d.id === widgetId);
  grid.addWidget(el, { x: def.x, y: def.y, w: def.w, h: def.h, autoPosition: true });

  // Re-render widget content
  const registry = WIDGET_REGISTRY[widgetId];
  if (registry) {
    for (const fnName of registry.renders) {
      if (typeof window[fnName] === 'function') {
        await window[fnName]();
      }
    }
  }

  if (editMode) addRemoveButtons();
  saveCurrentLayout();
  // Refresh modal if open
  if (document.getElementById('available-widgets-modal').classList.contains('active')) {
    openAvailableWidgetsModal();
  }
}

function openAvailableWidgetsModal() {
  const list = document.getElementById('available-widgets-list');
  if (!list) return;

  list.innerHTML = Object.entries(WIDGET_REGISTRY).map(([id, meta]) => {
    const isHidden = hiddenWidgets.includes(id);
    return `<div class="aw-item${isHidden ? ' aw-hidden' : ''}">
      <div class="aw-info">
        <div class="aw-name">${meta.label}</div>
        <div class="aw-desc">${meta.description}</div>
      </div>
      ${isHidden
        ? `<button class="aw-restore-btn" data-restore-widget="${id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 5v14M5 12h14"/></svg>
            Add
          </button>`
        : `<span class="aw-visible-badge">Visible</span>`
      }
    </div>`;
  }).join('');

  document.getElementById('available-widgets-modal').classList.add('active');
}

function closeAvailableWidgetsModal() {
  document.getElementById('available-widgets-modal').classList.remove('active');
}

async function resetLayout() {
  await F1Storage.saveToStorage(STORAGE_KEY_LAYOUT, null);
  window.location.reload();
}

window.F1Grid = {
  init: initGridManager,
  toggleEditMode,
  removeWidget,
  restoreWidget,
  resetLayout,
  openAvailableWidgetsModal,
  closeAvailableWidgetsModal,
  isEditMode: () => editMode,
};
