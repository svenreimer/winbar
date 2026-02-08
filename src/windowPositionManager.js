/**
 * Window Position Manager
 * Saves and restores window positions, sizes, and monitor placement
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    POSITION_SAVE_INTERVAL_SECONDS,
    POSITION_SAVE_DEBOUNCE_MS,
    POSITION_RESTORE_WINDOW_SECONDS,
    POSITION_RESTORE_DELAY_MS,
    POSITION_WAIT_MAX_ATTEMPTS,
    POSITION_DATA_EXPIRY_MS,
} from './constants.js';

const DATA_FILE_NAME = 'window-positions.json';

export class WindowPositionManager {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._windowData = {};
        this._windowCreatedId = null;
        this._saveTimeoutId = null;
        this._sessionModeChangedId = null;
        this._startupTime = GLib.get_monotonic_time(); // Track when manager started
        
        // Get the data directory path
        this._dataDir = GLib.build_filenamev([
            GLib.get_user_data_dir(),
            'gnome-shell',
            'extensions',
            'winbar@gnome-extension'
        ]);
        
        this._dataFilePath = GLib.build_filenamev([this._dataDir, DATA_FILE_NAME]);
        
        this._init();
    }
    
    _init() {
        if (!this._settings.get_boolean('restore-window-positions')) {
            return;
        }
        
        // Load saved window positions
        this._loadWindowPositions();
        
        // Connect to window creation signal
        this._windowCreatedId = global.display.connect('window-created', 
            (display, window) => this._onWindowCreated(window));
        
        // Connect to session mode changes for saving on logout
        this._sessionModeChangedId = Main.sessionMode.connect('updated',
            () => this._onSessionModeChanged());
        
        // Save positions periodically
        this._saveTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POSITION_SAVE_INTERVAL_SECONDS, () => {
            this._saveWindowPositions();
            return GLib.SOURCE_CONTINUE;
        });
        
        // Also save when windows are moved/resized (debounced)
        this._setupWindowTracking();
    }
    
    _setupWindowTracking() {
        // Track existing windows
        const windows = global.get_window_actors();
        windows.forEach(actor => {
            const window = actor.get_meta_window();
            if (window && this._isTrackableWindow(window)) {
                this._trackWindow(window);
            }
        });
    }
    
    _trackWindow(window) {
        try {
            // Check window is still valid
            if (!window || window.get_compositor_private() === null) {
                return;
            }
            
            // Connect to position/size change signals
            const positionChangedId = window.connect('position-changed', () => {
                this._schedulePositionSave();
            });
            
            const sizeChangedId = window.connect('size-changed', () => {
                this._schedulePositionSave();
            });
            
            // Store signal IDs for cleanup
            window._winbarPositionSignals = { positionChangedId, sizeChangedId };
        } catch (e) {
            // Window in invalid state, can't track
        }
    }
    
    _untrackWindow(window) {
        if (window._winbarPositionSignals) {
            window.disconnect(window._winbarPositionSignals.positionChangedId);
            window.disconnect(window._winbarPositionSignals.sizeChangedId);
            delete window._winbarPositionSignals;
        }
    }
    
    _schedulePositionSave() {
        // Debounce saves - wait 2 seconds after last change
        if (this._debounceSaveId) {
            GLib.source_remove(this._debounceSaveId);
        }
        
        this._debounceSaveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POSITION_SAVE_DEBOUNCE_MS, () => {
            this._saveWindowPositions();
            this._debounceSaveId = null;
            return GLib.SOURCE_REMOVE;
        });
    }
    
    _isTrackableWindow(window) {
        try {
            // Check window is valid first
            if (!window || window.get_compositor_private() === null) {
                return false;
            }
            
            // Only track normal windows
            if (window.get_window_type() !== Meta.WindowType.NORMAL) {
                return false;
            }
            
            // Skip skip-taskbar windows
            if (window.is_skip_taskbar()) {
                return false;
            }
            
            // Must have a valid WM_CLASS or app
            const windowClass = window.get_wm_class();
            const app = this._getAppForWindow(window);
            
            return !!(windowClass || (app && app.get_id()));
        } catch (e) {
            // Window in invalid state
            return false;
        }
    }
    
    _getAppForWindow(window) {
        const tracker = Shell.WindowTracker.get_default();
        return tracker.get_window_app(window);
    }
    
    _getWindowKey(window) {
        // Create a unique key for the window based on app ID and window class
        const app = this._getAppForWindow(window);
        const appId = app ? app.get_id() : '';
        const windowClass = window.get_wm_class() || '';
        
        // Use app ID + class as primary key
        return `${appId}::${windowClass}`;
    }
    
    _onWindowCreated(window) {
        if (!this._settings.get_boolean('restore-window-positions')) {
            return;
        }
        
        // Only restore positions within the startup window (for autostart apps)
        if (!this._isWithinRestoreWindow()) {
            return;
        }
        
        try {
            // Check early if it's override_redirect (popup menus, tooltips, etc.)
            if (!window || window.is_override_redirect()) {
                return;
            }
            
            // Skip windows without a valid compositor private (not yet fully realized)
            if (window.get_compositor_private() === null) {
                return;
            }
        } catch (e) {
            // Window might be in an invalid state
            return;
        }
        
        // Wait for window to be fully ready (properties like wm_class take time)
        this._waitForWindowReady(window, 0);
    }
    
    /**
     * Check if we're within the restore window (first N seconds after startup)
     * Position restoration only happens during this period to handle autostart apps
     */
    _isWithinRestoreWindow() {
        const elapsedMicroseconds = GLib.get_monotonic_time() - this._startupTime;
        const elapsedSeconds = elapsedMicroseconds / 1000000;
        return elapsedSeconds < POSITION_RESTORE_WINDOW_SECONDS;
    }
    
    _waitForWindowReady(window, attempts) {
        const maxAttempts = POSITION_WAIT_MAX_ATTEMPTS;
        const delay = POSITION_RESTORE_DELAY_MS;
        
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            try {
                // Check if window still exists and is valid
                if (!window) {
                    return GLib.SOURCE_REMOVE;
                }
                
                // Check for compositor private (window actor)
                if (window.get_compositor_private() === null) {
                    return GLib.SOURCE_REMOVE;
                }
                
                if (window.is_override_redirect()) {
                    return GLib.SOURCE_REMOVE;
                }
                
                const wmClass = window.get_wm_class();
                
                // If we have a wm_class, the window is ready
                if (wmClass && this._isTrackableWindow(window)) {
                    this._restoreWindowPosition(window);
                    this._trackWindow(window);
                    return GLib.SOURCE_REMOVE;
                }
                
                // Try again if we haven't reached max attempts
                if (attempts < maxAttempts - 1) {
                    this._waitForWindowReady(window, attempts + 1);
                }
            } catch (e) {
                // Window may be in invalid state, just stop trying
            }
            
            return GLib.SOURCE_REMOVE;
        });
    }
    
    _onSessionModeChanged() {
        // Save when going to lock screen or shutting down
        if (Main.sessionMode.currentMode === 'unlock-dialog' ||
            Main.sessionMode.currentMode === 'gdm' ||
            Main.sessionMode.currentMode === 'lock-screen') {
            this._saveWindowPositions();
        }
    }
    
    _restoreWindowPosition(window) {
        const key = this._getWindowKey(window);
        const savedData = this._windowData[key];
        
        if (!savedData) {
            return;
        }
        
        // Wait for window to stabilize before restoring position
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, POSITION_RESTORE_DELAY_MS, () => {
            try {
                // Comprehensive window validation
                if (!window) {
                    return GLib.SOURCE_REMOVE;
                }
                
                // Check if window is still valid and has required methods
                if (typeof window.get_window_type !== 'function') {
                    return GLib.SOURCE_REMOVE;
                }
                
                // Only restore for normal windows
                if (window.get_window_type() !== Meta.WindowType.NORMAL) {
                    return GLib.SOURCE_REMOVE;
                }
                
                // Skip override_redirect windows (popups, etc.)
                if (window.is_override_redirect()) {
                    return GLib.SOURCE_REMOVE;
                }
                
                // Don't restore if window is maximized or fullscreen
                const isMaximized = window.maximized_horizontally || window.maximized_vertically;
                if (isMaximized || window.is_fullscreen()) {
                    return GLib.SOURCE_REMOVE;
                }
                
                // Skip windows that are being destroyed or are unmanaged
                if (window.get_compositor_private() === null) {
                    return GLib.SOURCE_REMOVE;
                }
                
                const monitors = Main.layoutManager.monitors;
                const savedMonitor = savedData.monitor;
                
                // Check if saved monitor still exists
                let targetMonitor = monitors[savedMonitor];
                if (!targetMonitor) {
                    // Fall back to primary monitor
                    targetMonitor = monitors[Main.layoutManager.primaryIndex];
                }
                
                // Calculate position relative to target monitor
                let newX = savedData.x;
                let newY = savedData.y;
                
                // If monitor changed, adjust position to be on the target monitor
                const currentMonitor = window.get_monitor();
                if (savedMonitor !== currentMonitor && targetMonitor) {
                    // Keep relative position within monitor bounds
                    newX = Math.max(targetMonitor.x, Math.min(newX, targetMonitor.x + targetMonitor.width - savedData.width));
                    newY = Math.max(targetMonitor.y, Math.min(newY, targetMonitor.y + targetMonitor.height - savedData.height));
                }
                
                // Only move to monitor if it's different and valid
                // Skip move_to_monitor for now as it can cause crashes with some window types
                // The move_resize_frame should handle positioning correctly
                
                // Restore size and position
                window.move_resize_frame(false, newX, newY, savedData.width, savedData.height);
                
            } catch (e) {
                // Window may have been destroyed or is in invalid state
                // Silently ignore to prevent crashes
            }
            
            return GLib.SOURCE_REMOVE;
        });
    }
    
    _saveWindowPositions() {
        if (!this._settings.get_boolean('restore-window-positions')) {
            return;
        }
        
        const windows = global.get_window_actors();
        const newData = {};
        
        windows.forEach(actor => {
            try {
                const window = actor.get_meta_window();
                if (!window || !this._isTrackableWindow(window)) {
                    return;
                }
                
                // Skip maximized/fullscreen windows - we don't want to save those states
                const isMaximized = window.maximized_horizontally || window.maximized_vertically;
                if (isMaximized || window.is_fullscreen()) {
                    // Keep existing data if we have it
                    const key = this._getWindowKey(window);
                    if (this._windowData[key]) {
                        newData[key] = this._windowData[key];
                    }
                    return;
                }
                
                const key = this._getWindowKey(window);
                const rect = window.get_frame_rect();
                
                // Skip very small windows (likely splash screens, updaters, etc.)
                // Only save if larger than 400x300
                const minWidth = 400;
                const minHeight = 300;
                if (rect.width < minWidth || rect.height < minHeight) {
                    // Keep existing data if we have it (don't overwrite with small size)
                    if (this._windowData[key]) {
                        newData[key] = this._windowData[key];
                    }
                    return;
                }
                
                newData[key] = {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    monitor: window.get_monitor(),
                    wmClass: window.get_wm_class() || '',
                    lastSeen: Date.now()
                };
            } catch (e) {
                // Window in invalid state, skip it
            }
        });
        
        // Merge with existing data (keep windows that aren't currently open)
        // but only if they were seen in the last 30 days
        const thirtyDaysAgo = Date.now() - POSITION_DATA_EXPIRY_MS;
        
        for (const key in this._windowData) {
            if (!newData[key] && this._windowData[key].lastSeen > thirtyDaysAgo) {
                newData[key] = this._windowData[key];
            }
        }
        
        this._windowData = newData;
        this._writeDataFile();
    }
    
    _loadWindowPositions() {
        try {
            const file = Gio.File.new_for_path(this._dataFilePath);
            
            if (!file.query_exists(null)) {
                this._windowData = {};
                return;
            }
            
            const [success, contents] = file.load_contents(null);
            if (success) {
                const decoder = new TextDecoder('utf-8');
                const jsonStr = decoder.decode(contents);
                this._windowData = JSON.parse(jsonStr);
            }
        } catch (e) {
            log(`[Winbar] Error loading window positions: ${e.message}`);
            this._windowData = {};
        }
    }
    
    _writeDataFile() {
        try {
            // Ensure directory exists
            const dir = Gio.File.new_for_path(this._dataDir);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }
            
            const file = Gio.File.new_for_path(this._dataFilePath);
            const jsonStr = JSON.stringify(this._windowData, null, 2);
            const encoder = new TextEncoder();
            const contents = encoder.encode(jsonStr);
            
            file.replace_contents(
                contents,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (e) {
            log(`[Winbar] Error saving window positions: ${e.message}`);
        }
    }
    
    destroy() {
        // Save positions one last time
        if (this._settings.get_boolean('restore-window-positions')) {
            this._saveWindowPositions();
        }
        
        // Disconnect window created signal
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }
        
        // Disconnect session mode signal
        if (this._sessionModeChangedId) {
            Main.sessionMode.disconnect(this._sessionModeChangedId);
            this._sessionModeChangedId = null;
        }
        
        // Remove save timeout
        if (this._saveTimeoutId) {
            GLib.source_remove(this._saveTimeoutId);
            this._saveTimeoutId = null;
        }
        
        // Remove debounce timeout
        if (this._debounceSaveId) {
            GLib.source_remove(this._debounceSaveId);
            this._debounceSaveId = null;
        }
        
        // Untrack all windows
        const windows = global.get_window_actors();
        windows.forEach(actor => {
            const window = actor.get_meta_window();
            if (window) {
                this._untrackWindow(window);
            }
        });
    }
}
