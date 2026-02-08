import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Winbar } from './ui/panel.js';
import { TaskSwitcher } from './ui/taskSwitcher.js';
import { WindowPositionManager } from './windowPositionManager.js';

export default class WinbarExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._winbar = null;
        this._originalPanelVisible = true;
    }

    enable() {
        this._settings = this.getSettings();

        // Hide original panel
        this._originalPanelVisible = Main.panel.visible;
        if (this._settings.get_boolean('hide-original-panel')) {
            Main.panel.hide();
        }

        // Create Winbar instances
        this._winbars = [];
        this._createWinbars();

        // Setup Super key handler for Start Menu
        this._setupSuperKeyHandler();

        // Setup Alt+Tab task switcher
        this._setupTaskSwitcher();
        
        // Setup window position manager
        this._setupWindowPositionManager();

        // Prevent overview from showing on startup
        Main.overview.hide();

        // Also hide after a delay in case it shows during startup sequence
        this._overviewHideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._overviewHideTimeoutId = null;
            if (Main.overview.visible) {
                Main.overview.hide();
            }
            return GLib.SOURCE_REMOVE;
        });

        // Close start menu when overview is shown, and hide taskbar
        this._overviewShowingId = Main.overview.connect('showing', () => {
            this._winbars.forEach(winbar => {
                if (winbar && winbar._startMenu && winbar._startMenu._isOpen) {
                    winbar._startMenu.close();
                    winbar._startButton?.remove_style_class_name('active');
                }
                // Hide taskbar when overview is shown
                if (winbar) {
                    winbar.hide();
                }
            });
        });

        // Show taskbar when overview is hidden
        this._overviewHidingId = Main.overview.connect('hiding', () => {
            this._winbars.forEach(winbar => {
                if (winbar) {
                    winbar.show();
                }
            });
        });

        // Monitor changes
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._destroyWinbars();
            this._createWinbars();
        });

        // Settings changed
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            this._onSettingsChanged(key);
        });
    }

    disable() {
        // Remove startup overview hide timeout
        if (this._overviewHideTimeoutId) {
            GLib.source_remove(this._overviewHideTimeoutId);
            this._overviewHideTimeoutId = null;
        }

        // Remove Super key handler
        this._removeSuperKeyHandler();

        // Remove task switcher
        this._removeTaskSwitcher();
        
        // Remove window position manager
        this._removeWindowPositionManager();

        // Restore ArcMenu positioning before cleanup
        if (this._winbars && this._winbars.length > 0) {
            this._winbars[0]._restoreArcMenuIntegration();
        }

        // Restore original panel
        if (this._originalPanelVisible) {
            Main.panel.show();
        }

        // Remove all Winbars
        this._destroyWinbars();

        // Disconnect signals
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = null;
        }

        if (this._overviewHidingId) {
            Main.overview.disconnect(this._overviewHidingId);
            this._overviewHidingId = null;
        }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        this._settings = null;
    }
    
    _setupWindowPositionManager() {
        if (this._settings.get_boolean('restore-window-positions')) {
            this._windowPositionManager = new WindowPositionManager(this);
        }
    }
    
    _removeWindowPositionManager() {
        if (this._windowPositionManager) {
            this._windowPositionManager.destroy();
            this._windowPositionManager = null;
        }
    }

    _createWinbars() {
        const multiMonitorMode = this._settings.get_enum('multi-monitor-mode');
        const monitors = Main.layoutManager.monitors;
        const primaryMonitor = Main.layoutManager.primaryMonitor;

        // Determine which monitors to create winbars for
        let monitorsToUse = [];
        switch (multiMonitorMode) {
            case 0: // primary
                monitorsToUse = [primaryMonitor];
                break;
            case 1: // all (separate apps per monitor)
            case 2: // all-same (same apps on all monitors)
                // Ensure primary monitor is first for Super key handling
                monitorsToUse = [primaryMonitor, ...monitors.filter(m => m !== primaryMonitor)];
                break;
        }

        // Create a winbar for each monitor
        monitorsToUse.forEach(monitor => {
            const winbar = new Winbar(this, monitor);
            Main.layoutManager.addChrome(winbar, {
                affectsStruts: true,
                trackFullscreen: true,
            });
            this._positionWinbar(winbar, monitor);

            // Setup ArcMenu integration for primary winbar only
            if (monitor === primaryMonitor) {
                winbar._setupArcMenuIntegration();
            }

            this._winbars.push(winbar);
        });
    }

    _destroyWinbars() {
        if (this._winbars) {
            this._winbars.forEach(winbar => {
                if (winbar) {
                    Main.layoutManager.removeChrome(winbar);
                    winbar.destroy();
                }
            });
            this._winbars = [];
        }
    }

    _positionWinbar(winbar, monitor) {
        if (!monitor)
            return;

        const baseHeight = this._settings.get_int('taskbar-height');
        const position = this._settings.get_enum('taskbar-position');

        // Get the scale factor for proper sizing with HiDPI displays
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

        // Scale the height by the scale factor so it appears the correct size
        const height = Math.round(baseHeight * scaleFactor);

        if (position === 0) {
            // Bottom
            winbar.set_position(monitor.x, monitor.y + monitor.height - height);
        } else {
            // Top
            winbar.set_position(monitor.x, monitor.y);
        }
        winbar.set_size(monitor.width, height);

        // Store scaled height for other components to use
        winbar._scaledHeight = height;
        winbar._scaleFactor = scaleFactor;

        // Force the layout manager to update struts
        Main.layoutManager._queueUpdateRegions();
    }

    _positionAllWinbars() {
        this._winbars.forEach(winbar => {
            this._positionWinbar(winbar, winbar._monitor);
        });
    }

    _onSettingsChanged(key) {
        switch (key) {
            case 'hide-original-panel':
                if (this._settings.get_boolean('hide-original-panel')) {
                    Main.panel.hide();
                } else {
                    Main.panel.show();
                }
                break;
            case 'taskbar-position':
            case 'taskbar-height':
                this._positionAllWinbars();
                break;
            case 'multi-monitor-mode':
                // Recreate winbars when multi-monitor mode changes
                this._destroyWinbars();
                this._createWinbars();
                break;
            case 'restore-window-positions':
                // Toggle window position manager
                this._removeWindowPositionManager();
                this._setupWindowPositionManager();
                break;
            case 'enable-task-switcher':
                // Toggle task switcher at runtime
                this._removeTaskSwitcher();
                this._setupTaskSwitcher();
                break;
        }
    }

    _setupSuperKeyHandler() {
        // Override the Super key
        this._mutterSettings = new Gio.Settings({ schema: 'org.gnome.mutter' });
        
        // Store the original overlay-key value
        this._oldOverlayKey = this._mutterSettings.get_value('overlay-key');
        
        // Set overlay-key to Super_L (left Super key)
        this._mutterSettings.set_string('overlay-key', 'Super_L');
        
        // Allow the keybinding in all shell modes (including fullscreen)
        Main.wm.allowKeybinding('overlay-key', Shell.ActionMode.ALL);
        
        // Find and block the default overlay-key handler
        this._defaultOverlayKeyId = GObject.signal_handler_find(global.display, { signalId: 'overlay-key' });
        
        if (this._defaultOverlayKeyId) {
            GObject.signal_handler_block(global.display, this._defaultOverlayKeyId);
            
            // Connect our own handler
            this._overlayKeyId = global.display.connect('overlay-key', () => {
                this._toggleStartMenu();
                
                // Re-allow keybinding in all modes (workaround for some extensions)
                Main.wm.allowKeybinding('overlay-key', Shell.ActionMode.ALL);
                
                // Re-allow task switcher keybindings after start menu interaction
                // This is a workaround for potential keybinding mode reset
                if (this._settings.get_boolean('enable-task-switcher')) {
                    Main.wm.allowKeybinding('switch-windows', Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
                    Main.wm.allowKeybinding('switch-windows-backward', Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
                    Main.wm.allowKeybinding('switch-applications', Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
                    Main.wm.allowKeybinding('switch-applications-backward', Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
                }
            });
        } else {
            log('[Winbar] Warning: Could not find default overlay-key handler');
        }
    }

    _removeSuperKeyHandler() {
        // Disconnect our overlay-key handler
        if (this._overlayKeyId) {
            global.display.disconnect(this._overlayKeyId);
            this._overlayKeyId = null;
        }
        
        // Unblock the default overlay-key handler
        if (this._defaultOverlayKeyId) {
            GObject.signal_handler_unblock(global.display, this._defaultOverlayKeyId);
            this._defaultOverlayKeyId = null;
        }
        
        // Restore original overlay-key setting
        if (this._mutterSettings && this._oldOverlayKey) {
            this._mutterSettings.set_value('overlay-key', this._oldOverlayKey);
            this._oldOverlayKey = null;
        }
        
        // Restore default keybinding mode
        Main.wm.allowKeybinding('overlay-key', Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
        
        this._mutterSettings = null;
    }

    _setupTaskSwitcher() {
        if (!this._settings.get_boolean('enable-task-switcher')) {
            return;
        }

        this._taskSwitcher = null;
        
        // Use setCustomKeybindingHandler to override existing GNOME keybindings
        // This replaces the handler without changing the keybinding itself
        Main.wm.setCustomKeybindingHandler(
            'switch-windows',
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            (display, window, event, binding) => this._showTaskSwitcher(false, binding)
        );
        
        Main.wm.setCustomKeybindingHandler(
            'switch-windows-backward',
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            (display, window, event, binding) => this._showTaskSwitcher(true, binding)
        );
        
        Main.wm.setCustomKeybindingHandler(
            'switch-applications',
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            (display, window, event, binding) => this._showTaskSwitcher(false, binding)
        );
        
        Main.wm.setCustomKeybindingHandler(
            'switch-applications-backward',
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            (display, window, event, binding) => this._showTaskSwitcher(true, binding)
        );
    }

    _removeTaskSwitcher() {
        // Restore original keybinding handlers by setting them to null
        // This makes GNOME fall back to its default handlers
        try {
            Main.wm.setCustomKeybindingHandler('switch-windows', Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, null);
            Main.wm.setCustomKeybindingHandler('switch-windows-backward', Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, null);
            Main.wm.setCustomKeybindingHandler('switch-applications', Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, null);
            Main.wm.setCustomKeybindingHandler('switch-applications-backward', Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, null);
        } catch (e) {
            log(`[Winbar] Error restoring keybinding handlers: ${e.message}`);
        }
        
        // Destroy switcher if open
        if (this._taskSwitcher) {
            this._taskSwitcher.destroy();
            this._taskSwitcher = null;
        }
    }

    _showTaskSwitcher(backward, binding) {
        if (!this._taskSwitcher) {
            this._taskSwitcher = new TaskSwitcher(this);
        }
        const mask = binding.get_mask();
        this._taskSwitcher.show(backward, binding, mask);
    }

    _toggleStartMenu() {
        // Use primary winbar for start menu (always first in array due to _createWinbars)
        // This ensures Super key always opens start menu on primary monitor
        const winbar = this._winbars && this._winbars.length > 0 ? this._winbars[0] : null;
        if (!winbar || !winbar._startMenu)
            return;

        // If primary monitor is in fullscreen, temporarily show the taskbar
        const monitor = winbar._monitor;
        const isFullscreen = monitor && global.display.get_monitor_in_fullscreen(monitor.index);

        if (isFullscreen) {
            // Temporarily show winbar and start menu for fullscreen
            winbar.show();
        }

        if (winbar._startMenu._isOpen) {
            winbar._startMenu.close();
            // Remove active state from start button
            winbar._startButton?.remove_style_class_name('active');
            // Hide winbar again if in fullscreen
            if (isFullscreen) {
                winbar.hide();
            }
        } else {
            winbar._startMenu.open();
            // Add active state to start button
            winbar._startButton?.add_style_class_name('active');

            // When start menu closes in fullscreen, hide winbar
            if (isFullscreen) {
                const menuClosedId = winbar._startMenu.connect('menu-closed', () => {
                    winbar._startMenu.disconnect(menuClosedId);
                    // Check if still fullscreen and hide
                    const stillFullscreen = monitor && global.display.get_monitor_in_fullscreen(monitor.index);
                    if (stillFullscreen) {
                        winbar.hide();
                    }
                });
            }
        }
    }
}
