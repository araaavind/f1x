/**
 * F1 Dashboard - Storage Utilities
 * Handles Chrome storage for user preferences
 */

const STORAGE_KEYS = {
  favoriteDriver: "f1_favorite_driver",
  favoriteConstructor: "f1_favorite_constructor",
  settings: "f1_settings",
  themeMode: "f1_theme_mode",
  wallpaperData: "f1_wallpaper_data",
  wallpaperType: "f1_wallpaper_type",
};

/**
 * Save data to Chrome storage
 */
async function saveToStorage(key, value) {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ [key]: value }, resolve);
    } else {
      // Fallback to localStorage for testing
      localStorage.setItem(key, JSON.stringify(value));
      resolve();
    }
  });
}

/**
 * Load data from Chrome storage
 */
async function loadFromStorage(key, defaultValue = null) {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] !== undefined ? result[key] : defaultValue);
      });
    } else {
      // Fallback to localStorage for testing
      const value = localStorage.getItem(key);
      resolve(value ? JSON.parse(value) : defaultValue);
    }
  });
}

/**
 * Save favorite driver
 */
async function saveFavoriteDriver(driverNumber) {
  return saveToStorage(STORAGE_KEYS.favoriteDriver, driverNumber);
}

/**
 * Load favorite driver
 */
async function loadFavoriteDriver() {
  return loadFromStorage(STORAGE_KEYS.favoriteDriver, null);
}

/**
 * Save favorite constructor
 */
async function saveFavoriteConstructor(constructorName) {
  return saveToStorage(STORAGE_KEYS.favoriteConstructor, constructorName);
}

/**
 * Load favorite constructor
 */
async function loadFavoriteConstructor() {
  return loadFromStorage(STORAGE_KEYS.favoriteConstructor, null);
}

/**
 * Save all settings
 */
async function saveSettings(settings) {
  return saveToStorage(STORAGE_KEYS.settings, settings);
}

/**
 * Load all settings
 */
async function loadSettings() {
  return loadFromStorage(STORAGE_KEYS.settings, {
    favoriteDriver: null,
    favoriteConstructor: null,
    refreshInterval: 60000,
  });
}

/**
 * Save theme mode ('default' or 'wallpaper')
 */
async function saveThemeMode(mode) {
  return saveToStorage(STORAGE_KEYS.themeMode, mode);
}

/**
 * Load theme mode
 */
async function loadThemeMode() {
  return loadFromStorage(STORAGE_KEYS.themeMode, "default");
}

/**
 * Save wallpaper data (base64 or URL string) and its type ('url' or 'file')
 */
async function saveWallpaper(data, type) {
  await saveToStorage(STORAGE_KEYS.wallpaperData, data);
  await saveToStorage(STORAGE_KEYS.wallpaperType, type);
}

/**
 * Load wallpaper data
 */
async function loadWallpaper() {
  const data = await loadFromStorage(STORAGE_KEYS.wallpaperData, null);
  const type = await loadFromStorage(STORAGE_KEYS.wallpaperType, null);
  return { data, type };
}

/**
 * Clear wallpaper
 */
async function clearWallpaper() {
  await saveToStorage(STORAGE_KEYS.wallpaperData, null);
  await saveToStorage(STORAGE_KEYS.wallpaperType, null);
}

// Export functions
window.F1Storage = {
  saveFavoriteDriver,
  loadFavoriteDriver,
  saveFavoriteConstructor,
  loadFavoriteConstructor,
  saveSettings,
  loadSettings,
  saveThemeMode,
  loadThemeMode,
  saveWallpaper,
  loadWallpaper,
  clearWallpaper,
};
