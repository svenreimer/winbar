import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { getEffectiveThemeMode } from '../utils.js';
import {
    ORPHAN_CHECK_DELAYS,
    OFF_SCREEN_POSITION,
    WINDOW_CLEANUP_INTERVAL_SECONDS,
    WINDOW_REMOVAL_DELAY_MS,
    APP_ASSOCIATION_CHECK_INTERVAL_MS,
    APP_ASSOCIATION_MAX_CHECKS,
    MENU_OFFSET_PX,
    MENU_SCREEN_PADDING_PX,
    THEME_COLORS,
} from '../constants.js';
import { WidgetsButton } from './widgetsButton.js';
import { StartMenu } from './startMenu.js';
import { SearchButton } from './searchButton.js';
import { SystemTray } from './systemTray.js';
import { ClockButton } from './clockButton.js';
import { NotificationButton } from './notificationButton.js';
import { ShowDesktopButton } from './showDesktopButton.js';
import { TaskbarButton, WindowButton } from './taskbarButton.js';

export const Winbar = GObject.registerClass({
    GTypeName: 'WinbarPanel',
},
    class Winbar extends St.Widget {
        _init(extension, monitor) {
            super._init({
                name: 'winbar',
                style_class: 'winbar-panel',
                reactive: true,
                track_hover: true,
                layout_manager: new Clutter.BinLayout(),
            });

            this._extension = extension;
            this._settings = extension.getSettings();
            this._monitor = monitor;
            this._isReorderingApps = false;
            this._windowRemovalTimeouts = [];
            this._isDestroyed = false;

            // Setup right-click context menu
            this._setupContextMenu();

            // Main layout - use a box layout that spans full width
            this._layout = new St.BoxLayout({
                style_class: 'winbar-layout',
                x_expand: true,
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._layout);

            // Left section (widgets)
            this._leftBox = new St.BoxLayout({
                style_class: 'winbar-left-box',
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._layout.add_child(this._leftBox);

            // Left spacer - pushes center to middle
            this._leftSpacer = new St.Widget({
                x_expand: true,
            });
            this._layout.add_child(this._leftSpacer);

            // Center section (start button, search, apps)
            this._centerBox = new St.BoxLayout({
                style_class: 'winbar-center-box',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._layout.add_child(this._centerBox);

            // Right spacer - balances left spacer
            this._rightSpacer = new St.Widget({
                x_expand: true,
            });
            this._layout.add_child(this._rightSpacer);

            // Right section (system tray, clock) - fixed to right edge
            this._rightBox = new St.BoxLayout({
                style_class: 'winbar-right-box',
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._layout.add_child(this._rightBox);

            this._buildTaskbar();
            this._connectSignals();
            this._applySettings();
        }

        _buildTaskbar() {
            // === LEFT SECTION ===
            // Widgets button
            this._widgetsButton = new WidgetsButton(this._extension, this);
            this._leftBox.add_child(this._widgetsButton);

            // === CENTER SECTION ===
            // Start button with icon
            this._startButtonIcon = new St.Icon({
                icon_name: 'start-here-symbolic',
                icon_size: 24,
            });
            this._startButton = new St.Button({
                style_class: 'winbar-start-button',
                child: this._startButtonIcon,
            });
            this._updateStartButtonIcon();

            // Create our custom Start Menu
            this._startMenu = new StartMenu(this._extension, this);
            Main.layoutManager.addChrome(this._startMenu, {
                affectsStruts: false,
                trackFullscreen: true,
            });
            // Ensure hidden AFTER addChrome (addChrome can make it visible)
            this._startMenu.hide();
            this._startMenu.opacity = 0;
            this._startMenu.set_position(OFF_SCREEN_POSITION, OFF_SCREEN_POSITION); // Move off-screen initially

            // Connect start button to toggle the menu (left click)
            this._startButton.connect('clicked', () => {
                // If ArcMenu is preferred and available, use it
                if (this._settings.get_boolean('use-arcmenu') && Main.panel.statusArea['ArcMenu']) {
                    const arcMenu = Main.panel.statusArea['ArcMenu'];
                    this._setupArcMenuIntegration();
                    arcMenu.toggleMenu();
                } else {
                    // Use our custom Start Menu
                    this._startMenu.toggle();
                    // Update start button active state
                    if (this._startMenu._isOpen) {
                        this._startButton.add_style_class_name('active');
                    } else {
                        this._startButton.remove_style_class_name('active');
                    }
                }
            });

            // Setup Windows-style right-click menu for Start button
            this._setupStartButtonContextMenu();

            // Close menu when clicking elsewhere
            this._startMenu.connect('menu-closed', () => {
                // Remove active state from start button (check for disposal)
                if (this._startButton && !this._startButton._disposed) {
                    try {
                        this._startButton.remove_style_class_name('active');
                    } catch (e) {
                        // Button may have been disposed during reload
                    }
                }
            });

            this._centerBox.add_child(this._startButton);

            // Search button
            this._searchButton = new SearchButton(this._extension, this);
            this._centerBox.add_child(this._searchButton);

            // Task view button
            this._taskViewButton = new St.Button({
                style_class: 'winbar-taskview-button',
                child: new St.Icon({
                    icon_name: 'view-grid-symbolic',
                    icon_size: 20,
                }),
            });
            this._taskViewButton.connect('clicked', () => {
                Main.overview.toggle();
            });
            this._centerBox.add_child(this._taskViewButton);

            // App buttons container
            this._appContainer = new St.BoxLayout({
                style_class: 'winbar-app-container',
            });
            this._centerBox.add_child(this._appContainer);

            // Make the app container a drop target
            this._appContainer._delegate = this;

            // === RIGHT SECTION ===
            // System tray
            this._systemTray = new SystemTray(this._extension, this);
            this._rightBox.add_child(this._systemTray);

            // Clock
            this._clockButton = new ClockButton(this._extension, this);
            this._rightBox.add_child(this._clockButton);

            // Notification button
            this._notificationButton = new NotificationButton(this._extension, this);
            this._rightBox.add_child(this._notificationButton);

            // Show desktop button
            this._showDesktopButton = new ShowDesktopButton(this._extension);
            this._rightBox.add_child(this._showDesktopButton);

            // Populate pinned apps
            this._refreshApps();
        }

        _connectSignals() {
            // App system signals
            this._appSystemId = Shell.AppSystem.get_default().connect('installed-changed', () => {
                this._refreshApps();
            });

            // Favorites changed
            this._favoritesId = AppFavorites.getAppFavorites().connect('changed', () => {
                if (!this._isReorderingApps) {
                    this._refreshApps();
                }
            });

            // Window tracking
            this._windowAddedId = global.display.connect('window-created', (display, window) => {
                this._onWindowAdded(window);
            });

            this._focusWindowId = global.display.connect('notify::focus-window', () => {
                this._updateAppStates();
            });

            // Settings changed
            this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
                this._onSettingChanged(key);
            });

            // Listen for system theme changes (for auto mode)
            try {
                this._interfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
                this._interfaceSettingsId = this._interfaceSettings.connect('changed::color-scheme', () => {
                    // Only update if we're in auto mode
                    if (this._settings.get_enum('theme-mode') === 0) {
                        this._updatePanelStyle();
                        if (this._startMenu) {
                            this._startMenu.updateTheme();
                        }
                        if (this._searchButton) {
                            this._searchButton.updateTheme();
                            if (this._searchButton._searchDialog) {
                                this._searchButton._searchDialog._applyTheme();
                            }
                        }
                        if (this._clockButton) {
                            this._clockButton.updateTheme();
                        }
                        if (this._notificationButton) {
                            this._notificationButton.updateTheme();
                        }
                        if (this._systemTray) {
                            this._systemTray.updateTheme();
                        }
                    }
                });
            } catch (e) {
                log(`[Winbar] Could not listen to system theme changes: ${e.message}`);
            }

            // Track existing windows
            global.get_window_actors().forEach(actor => {
                this._onWindowAdded(actor.meta_window);
            });

            // Lock screen detection - hide taskbar when locked
            this._sessionModeId = Main.sessionMode.connect('updated', () => {
                this._updateVisibility();
            });

            // Fullscreen window detection
            this._fullscreenChangedId = global.display.connect('in-fullscreen-changed', () => {
                this._updateVisibility();
            });

            // Also check on workspace switch (fullscreen state may differ per workspace)
            this._workspaceSwitchedId = global.workspace_manager.connect('active-workspace-changed', () => {
                this._updateVisibility();
            });

            // Initial visibility check
            this._updateVisibility();

            // Start periodic cleanup for invalid windows (runs every 5 seconds)
            this._startWindowCleanupTimer();
        }

        _updateVisibility() {
            // Hide during lock screen
            if (Main.sessionMode.isLocked) {
                this.hide();
                if (this._startMenu) {
                    this._startMenu.hide();
                }
                return;
            }

            // Hide during fullscreen on this winbar's monitor
            if (this._monitor) {
                const isFullscreen = global.display.get_monitor_in_fullscreen(this._monitor.index);
                if (isFullscreen) {
                    this.hide();
                    if (this._startMenu) {
                        this._startMenu.hide();
                    }
                    return;
                }
            }

            // Show taskbar if not locked and not fullscreen
            this.show();
        }

        _startWindowCleanupTimer() {
            // Run cleanup periodically to remove invalid windows
            this._windowCleanupTimerId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                WINDOW_CLEANUP_INTERVAL_SECONDS,
                () => {
                    if (this._isDestroyed) return GLib.SOURCE_REMOVE;
                    this._cleanupInvalidWindows();
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }

        _cleanupInvalidWindows() {
            if (this._isDestroyed) return;

            try {
                // Clean up orphan window buttons that should be skipped
                if (this._windowButtons) {
                    const toRemove = [];
                    this._windowButtons.forEach((button, wmClass) => {
                        // Check if all windows in this button should be skipped
                        const validWindows = button._windows?.filter(w => {
                            try {
                                // Check if window is still valid and shouldn't be skipped
                                return w && !w.is_skip_taskbar?.() && !this._shouldSkipWindow(w);
                            } catch (e) {
                                return false; // Window likely destroyed
                            }
                        }) || [];

                        if (validWindows.length === 0) {
                            toRemove.push(wmClass);
                        }
                    });

                    toRemove.forEach(wmClass => {
                        const button = this._windowButtons.get(wmClass);
                        if (button) {
                            try { button.destroy(); } catch (e) { /* Actor may already be destroyed */ }
                            this._windowButtons.delete(wmClass);
                        }
                    });
                }

                // Also clean up any app buttons that only have skipped windows
                if (this._appButtons) {
                    const toRemove = [];
                    this._appButtons.forEach((button, appId) => {
                        const app = button._app;
                        if (!app) return;

                        // Check if app is a favorite (should always be shown)
                        const favorites = AppFavorites.getAppFavorites().getFavorites();
                        const isFavorite = favorites.some(fav => fav.get_id() === appId);
                        if (isFavorite) return;

                        // Check if app has valid windows
                        const windows = app.get_windows?.() || [];
                        const validWindows = windows.filter(w => {
                            try {
                                return !w.is_skip_taskbar?.() && !this._shouldSkipWindow(w);
                            } catch (e) {
                                return false;
                            }
                        });

                        if (validWindows.length === 0) {
                            toRemove.push(appId);
                        }
                    });

                    toRemove.forEach(appId => {
                        const button = this._appButtons.get(appId);
                        if (button) {
                            try { button.destroy(); } catch (e) { /* Actor may already be destroyed */ }
                            this._appButtons.delete(appId);
                        }
                    });
                }
            } catch (e) {
                log(`[Winbar] Error in window cleanup: ${e.message}`);
            }
        }

        _setupContextMenu() {
            // Create a simple popup menu without source actor positioning
            this._contextMenu = new PopupMenu.PopupMenu(this, 0.0, St.Side.TOP);
            Main.uiGroup.add_child(this._contextMenu.actor);
            this._contextMenu.actor.hide();

            // Store for cursor-based positioning
            this._menuCursorX = 0;
            this._menuCursorY = 0;

            // Override the menu's position calculation
            this._contextMenu._boxPointer.setPosition = (sourceActor, alignment) => {
                // Use our stored cursor position instead
                const monitor = Main.layoutManager.primaryMonitor;
                const menuActor = this._contextMenu.actor;
                const [menuWidth, menuHeight] = menuActor.get_size();

                let x = this._menuCursorX - (menuWidth / 2);
                let y = this._menuCursorY - menuHeight - MENU_OFFSET_PX;

                // Keep within screen bounds - horizontal
                if (x < monitor.x + MENU_SCREEN_PADDING_PX)
                    x = monitor.x + MENU_SCREEN_PADDING_PX;
                if (x + menuWidth > monitor.x + monitor.width - MENU_SCREEN_PADDING_PX)
                    x = monitor.x + monitor.width - menuWidth - MENU_SCREEN_PADDING_PX;

                // Keep within screen bounds - vertical
                if (y < monitor.y + MENU_SCREEN_PADDING_PX)
                    y = this._menuCursorY + MENU_OFFSET_PX; // Open below cursor if no room above
                if (y + menuHeight > monitor.y + monitor.height - MENU_SCREEN_PADDING_PX)
                    y = monitor.y + monitor.height - menuHeight - MENU_SCREEN_PADDING_PX;

                menuActor.set_position(Math.floor(x), Math.floor(y));
            };

            // Close menu when clicking outside
            this._capturedEventId = null;
            this._contextMenu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    // Add global event capture to detect clicks outside
                    this._capturedEventId = global.stage.connect('captured-event', (actor, event) => {
                        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                            const [eventX, eventY] = event.get_coords();
                            const menuActor = this._contextMenu.actor;
                            const [menuX, menuY] = menuActor.get_transformed_position();
                            const [menuWidth, menuHeight] = menuActor.get_size();

                            // Check if click is outside the menu
                            if (eventX < menuX || eventX > menuX + menuWidth ||
                                eventY < menuY || eventY > menuY + menuHeight) {
                                this._contextMenu.close();
                                return Clutter.EVENT_STOP;
                            }
                        }
                        return Clutter.EVENT_PROPAGATE;
                    });
                } else {
                    // Remove the event capture when menu closes
                    if (this._capturedEventId) {
                        global.stage.disconnect(this._capturedEventId);
                        this._capturedEventId = null;
                    }
                }
            });

            // === Taskbar Settings Section ===
            const settingsSection = new PopupMenu.PopupMenuSection();
            this._contextMenu.addMenuItem(settingsSection);

            // Taskbar Settings
            const taskbarSettingsItem = new PopupMenu.PopupMenuItem(_('Taskbar Settings'));
            taskbarSettingsItem.connect('activate', () => {
                this._extension.openPreferences();
            });
            settingsSection.addMenuItem(taskbarSettingsItem);

            // ArcMenu Settings (if available)
            this._arcMenuSettingsItem = new PopupMenu.PopupMenuItem(_('ArcMenu Settings'));
            this._arcMenuSettingsItem.connect('activate', () => {
                // Try to open ArcMenu preferences
                try {
                    const arcMenuExtension = Main.extensionManager.lookup('arcmenu@arcmenu.com');
                    if (arcMenuExtension) {
                        arcMenuExtension.openPreferences();
                    }
                } catch (e) {
                    // Fallback: try via command
                    const subprocess = Gio.Subprocess.new(
                        ['gnome-extensions', 'prefs', 'arcmenu@arcmenu.com'],
                        Gio.SubprocessFlags.NONE
                    );
                }
            });
            settingsSection.addMenuItem(this._arcMenuSettingsItem);

            // Update ArcMenu visibility
            this._updateArcMenuVisibility();

            this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // === Actions Section ===
            const actionsSection = new PopupMenu.PopupMenuSection();
            this._contextMenu.addMenuItem(actionsSection);

            // Task Manager
            const taskManagerItem = new PopupMenu.PopupMenuItem(_('Task Manager'));
            taskManagerItem.connect('activate', () => {
                try {
                    Gio.Subprocess.new(
                        ['gnome-system-monitor'],
                        Gio.SubprocessFlags.NONE
                    );
                } catch (e) {
                    // Try alternative
                    try {
                        Gio.Subprocess.new(
                            ['gnome-usage'],
                            Gio.SubprocessFlags.NONE
                        );
                    } catch (e2) {
                        // Ignore
                    }
                }
            });
            actionsSection.addMenuItem(taskManagerItem);

            // Show Desktop
            const showDesktopItem = new PopupMenu.PopupMenuItem(_('Show Desktop'));
            showDesktopItem.connect('activate', () => {
                this._showDesktopButton._toggleDesktop();
            });
            actionsSection.addMenuItem(showDesktopItem);

            this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // === System Section ===
            const systemSection = new PopupMenu.PopupMenuSection();
            this._contextMenu.addMenuItem(systemSection);

            // GNOME Settings
            const gnomeSettingsItem = new PopupMenu.PopupMenuItem(_('System Settings'));
            gnomeSettingsItem.connect('activate', () => {
                const app = Shell.AppSystem.get_default().lookup_app('gnome-control-center.desktop');
                if (app) {
                    app.activate();
                } else {
                    try {
                        Gio.Subprocess.new(
                            ['gnome-control-center'],
                            Gio.SubprocessFlags.NONE
                        );
                    } catch (e) {
                        // Ignore
                    }
                }
            });
            systemSection.addMenuItem(gnomeSettingsItem);

            // Extensions
            const extensionsItem = new PopupMenu.PopupMenuItem(_('Extensions'));
            extensionsItem.connect('activate', () => {
                // Try multiple desktop file names
                const desktopIds = [
                    'org.gnome.Extensions.desktop',
                    'gnome-extensions.desktop',
                    'com.mattjakeman.ExtensionManager.desktop',
                ];

                let app = null;
                for (const id of desktopIds) {
                    app = Shell.AppSystem.get_default().lookup_app(id);
                    if (app) break;
                }

                if (app) {
                    app.activate();
                } else {
                    // Try command line alternatives
                    const commands = [
                        ['gnome-extensions-app'],
                        ['extension-manager'],
                        ['gnome-shell-extension-prefs'],
                    ];

                    for (const cmd of commands) {
                        try {
                            Gio.Subprocess.new(cmd, Gio.SubprocessFlags.NONE);
                            break;
                        } catch (e) {
                            continue;
                        }
                    }
                }
            });
            systemSection.addMenuItem(extensionsItem);

            // Connect right-click handler
            this.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 3) { // Right click
                    // Coordinate guard: if the click lands inside the system-tray
                    // bounding box, let the tray handle it.  This is needed for
                    // XEmbed / Wine tray icons which are separate compositor
                    // windows and never appear in our actor hierarchy.
                    if (this._systemTray) {
                        const [evX, evY] = event.get_coords();
                        const [trayX, trayY] = this._systemTray.get_transformed_position();
                        const [trayW, trayH] = this._systemTray.get_size();
                        if (evX >= trayX && evX <= trayX + trayW &&
                            evY >= trayY && evY <= trayY + trayH) {
                            return Clutter.EVENT_PROPAGATE;
                        }
                    }

                    // Check if click is on a taskbar button - let it handle its own context menu
                    const source = event.get_source();
                    let current = source;
                    while (current) {
                        if (current._isTaskbarButton) {
                            // Let the TaskbarButton handle its own right-click
                            return Clutter.EVENT_PROPAGATE;
                        }
                        // Check if it's a tray icon (prevent Winbar menu overlay)
                        if (current.has_style_class_name('winbar-tray-icons') ||
                            current.has_style_class_name('winbar-appindicator-icons') ||
                            current.has_style_class_name('winbar-hijacked-tray-item')) {
                            // Let the tray icon handle its own right-click
                            return Clutter.EVENT_PROPAGATE;
                        }
                        current = current.get_parent();
                    }

                    // Not on a taskbar button - show Winbar's context menu
                    const [x, y] = event.get_coords();
                    this._menuCursorX = x;
                    this._menuCursorY = y;

                    this._updateContextMenuState();
                    this._contextMenu.toggle();

                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _updateArcMenuVisibility() {
            // Check if ArcMenu is installed and enabled
            const arcMenuAvailable = Main.panel.statusArea['ArcMenu'] !== undefined;
            this._arcMenuSettingsItem.visible = arcMenuAvailable;
        }

        _repositionArcMenu(arcMenu) {
            // Get the start button position
            const [buttonX, buttonY] = this._startButton.get_transformed_position();
            const [buttonWidth, buttonHeight] = this._startButton.get_size();

            // Get ArcMenu's menu actor
            const menuActor = arcMenu.arcMenu?.actor || arcMenu.arcMenu?._boxPointer;
            if (!menuActor)
                return;

            const [menuWidth, menuHeight] = menuActor.get_size();
            const monitor = Main.layoutManager.primaryMonitor;

            // Position above the start button, centered
            let x = buttonX + (buttonWidth / 2) - (menuWidth / 2);
            let y = buttonY - menuHeight - MENU_OFFSET_PX;

            // Keep within screen bounds
            if (x < monitor.x + MENU_SCREEN_PADDING_PX)
                x = monitor.x + MENU_SCREEN_PADDING_PX;
            if (x + menuWidth > monitor.x + monitor.width - MENU_SCREEN_PADDING_PX)
                x = monitor.x + monitor.width - menuWidth - MENU_SCREEN_PADDING_PX;
            if (y < monitor.y + MENU_SCREEN_PADDING_PX)
                y = buttonY + buttonHeight + MENU_OFFSET_PX;

            menuActor.set_position(Math.floor(x), Math.floor(y));
        }

        _setupArcMenuIntegration() {
            // Check if ArcMenu is available
            const arcMenu = Main.panel.statusArea['ArcMenu'];
            if (!arcMenu || !arcMenu.arcMenu)
                return;

            // Override the _boxPointer's setPosition to use our start button position
            const boxPointer = arcMenu.arcMenu._boxPointer;
            if (boxPointer && !this._arcMenuOriginalSetPosition) {
                this._arcMenuOriginalSetPosition = boxPointer.setPosition.bind(boxPointer);

                boxPointer.setPosition = (sourceActor, alignment) => {
                    // Get our start button position instead
                    const [buttonX, buttonY] = this._startButton.get_transformed_position();
                    const [buttonWidth, buttonHeight] = this._startButton.get_size();

                    // Calculate menu position
                    const themeNode = boxPointer.get_theme_node();
                    const [menuMinWidth, menuMinHeight, menuNatWidth, menuNatHeight] = boxPointer.get_preferred_size();

                    const monitor = Main.layoutManager.primaryMonitor;

                    // Position above the button, centered
                    let x = buttonX + (buttonWidth / 2) - (menuNatWidth / 2);
                    let y = buttonY - menuNatHeight - MENU_OFFSET_PX;

                    // Keep within screen bounds
                    if (x < monitor.x + MENU_SCREEN_PADDING_PX)
                        x = monitor.x + MENU_SCREEN_PADDING_PX;
                    if (x + menuNatWidth > monitor.x + monitor.width - MENU_SCREEN_PADDING_PX)
                        x = monitor.x + monitor.width - menuNatWidth - MENU_SCREEN_PADDING_PX;
                    if (y < monitor.y + MENU_SCREEN_PADDING_PX)
                        y = buttonY + buttonHeight + MENU_OFFSET_PX;

                    boxPointer.set_position(Math.floor(x), Math.floor(y));

                    // Update arrow position to point at button center
                    boxPointer._arrowOrigin = buttonX + buttonWidth / 2;
                };
            }
        }

        _restoreArcMenuIntegration() {
            const arcMenu = Main.panel.statusArea['ArcMenu'];
            if (arcMenu && arcMenu.arcMenu && this._arcMenuOriginalSetPosition) {
                arcMenu.arcMenu._boxPointer.setPosition = this._arcMenuOriginalSetPosition;
                this._arcMenuOriginalSetPosition = null;
            }
        }

        _updateContextMenuState() {
            // Update ArcMenu visibility
            this._updateArcMenuVisibility();
        }

        _applySettings() {
            // Apply all visibility settings
            this._widgetsButton.visible = this._settings.get_boolean('show-widgets');
            this._startButton.visible = this._settings.get_boolean('show-start-button');
            this._searchButton.visible = this._settings.get_boolean('show-search');
            this._taskViewButton.visible = this._settings.get_boolean('show-task-view');
            this._systemTray.visible = this._settings.get_boolean('show-system-tray');
            this._clockButton.visible = this._settings.get_boolean('show-clock');
            this._notificationButton.visible = this._settings.get_boolean('show-notifications');
            this._showDesktopButton.visible = this._settings.get_boolean('show-show-desktop');

            // Apply panel styling
            this._updatePanelStyle();

            // Apply spacing settings
            this._updateSpacing();

            // Apply theme to components
            if (this._startMenu) {
                this._startMenu.updateTheme();
            }
            if (this._searchButton) {
                this._searchButton.updateTheme();
            }
            if (this._clockButton) {
                this._clockButton.updateTheme();
            }
            if (this._notificationButton) {
                this._notificationButton.updateTheme();
            }
            if (this._systemTray) {
                this._systemTray.updateTheme();
            }

            // Apply center alignment
            this._updateCenterAlignment();
        }

        _updateCenterAlignment() {
            const centered = this._settings.get_boolean('center-taskbar-items');

            if (centered) {
                // Center the taskbar items
                this._centerBox.x_align = Clutter.ActorAlign.CENTER;
                this._leftSpacer.x_expand = true;
                this._rightSpacer.x_expand = true;
            } else {
                // Align to start (left)
                this._centerBox.x_align = Clutter.ActorAlign.START;
                this._leftSpacer.x_expand = false;
                this._rightSpacer.x_expand = true;
            }
        }

        _updatePanelStyle() {
            const opacity = this._settings.get_int('panel-opacity') / 100;
            const borderRadius = this._settings.get_int('border-radius');
            const effectiveMode = getEffectiveThemeMode(this._settings);
            const hPadding = this._settings.get_int('panel-padding-horizontal');
            const vPadding = this._settings.get_int('panel-padding-vertical');
            const blurEnabled = this._settings.get_boolean('blur-effect');
            const blurStrength = this._settings.get_int('blur-strength');
            const isLight = effectiveMode === 2;

            let bgColor, borderColor;
            if (isLight) {
                // Light mode
                bgColor = `rgba(243, 243, 243, ${opacity})`;
                borderColor = THEME_COLORS.light.border;
            } else {
                // Dark mode
                bgColor = `rgba(32, 32, 32, ${opacity})`;
                borderColor = THEME_COLORS.dark.border;
            }

            this.set_style(`background-color: ${bgColor}; border-radius: ${borderRadius}px ${borderRadius}px 0 0; padding: ${vPadding}px ${hPadding}px; border-top: 1px solid ${borderColor};`);

            // Add/remove light mode CSS class for child elements
            if (isLight) {
                this.add_style_class_name('light');
            } else {
                this.remove_style_class_name('light');
            }

            // Update all child component themes
            this._updateChildThemes();

            // Apply blur effect
            this._updateBlurEffect(blurEnabled, blurStrength);
        }

        _updateChildThemes() {
            const effectiveMode = getEffectiveThemeMode(this._settings);
            const isLight = effectiveMode === 2;

            // Update Start Button icon color
            if (this._startButtonIcon) {
                this._startButtonIcon.set_style(`color: -st-accent-color;`);
            }

            // Update Task View button
            if (this._taskViewButton) {
                const taskViewIcon = this._taskViewButton.get_child();
                if (taskViewIcon) {
                    const iconColor = isLight ? THEME_COLORS.light.iconColor : THEME_COLORS.dark.iconColor;
                    taskViewIcon.set_style(`color: ${iconColor};`);
                }
            }

            // Update Widgets button
            if (this._widgetsButton) {
                this._widgetsButton.updateTheme?.();
            }

            // Update app buttons
            if (this._appButtons) {
                this._appButtons.forEach(button => {
                    button.updateTheme?.();
                });
            }
        }

        _updateBlurEffect(enabled, strength) {
            // Remove existing blur effect
            if (this._blurEffect) {
                this.remove_effect(this._blurEffect);
                this._blurEffect = null;
            }

            // Add blur effect if enabled
            if (enabled && strength > 0) {
                try {
                    // Shell.BlurEffect properties vary by GNOME Shell version
                    // Create effect with basic properties first
                    this._blurEffect = new Shell.BlurEffect({
                        brightness: 1.0,
                        mode: Shell.BlurMode.BACKGROUND,
                    });

                    // Try to set blur radius/sigma after creation if available
                    try {
                        if ('radius' in this._blurEffect) {
                            this._blurEffect.radius = strength * 0.5;
                        } else if ('sigma' in this._blurEffect) {
                            this._blurEffect.sigma = strength * 0.5;
                        }
                    } catch (propError) {
                        // Property not available in this GNOME Shell version
                        log(`[Winbar] Blur strength not supported: ${propError.message}`);
                    }

                    this.add_effect(this._blurEffect);
                } catch (e) {
                    log(`[Winbar] Could not create blur effect: ${e.message}`);
                }
            }
        }

        _setupStartButtonContextMenu() {
            // Create Windows-style power user menu (Win+X menu)
            this._startContextMenu = new PopupMenu.PopupMenu(this._startButton, 0.5, St.Side.TOP);
            Main.uiGroup.add_child(this._startContextMenu.actor);
            this._startContextMenu.actor.hide();

            // Close menu when clicking outside
            this._startContextMenuCapturedEventId = null;
            this._startContextMenu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    this._startContextMenuCapturedEventId = global.stage.connect('captured-event', (actor, event) => {
                        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                            const [eventX, eventY] = event.get_coords();
                            const menuActor = this._startContextMenu.actor;
                            const [menuX, menuY] = menuActor.get_transformed_position();
                            const [menuWidth, menuHeight] = menuActor.get_size();

                            if (eventX < menuX || eventX > menuX + menuWidth ||
                                eventY < menuY || eventY > menuY + menuHeight) {
                                this._startContextMenu.close();
                                return Clutter.EVENT_STOP;
                            }
                        }
                        return Clutter.EVENT_PROPAGATE;
                    });
                } else {
                    if (this._startContextMenuCapturedEventId) {
                        global.stage.disconnect(this._startContextMenuCapturedEventId);
                        this._startContextMenuCapturedEventId = null;
                    }
                }
            });

            // === Apps & Features ===
            const appsItem = new PopupMenu.PopupMenuItem(_('Installed Apps'));
            appsItem.connect('activate', () => {
                try {
                    Gio.Subprocess.new(['gnome-control-center', 'applications'], Gio.SubprocessFlags.NONE);
                } catch (e) {
                    // Try alternative
                    const app = Shell.AppSystem.get_default().lookup_app('org.gnome.Software.desktop');
                    if (app) app.activate();
                }
            });
            this._startContextMenu.addMenuItem(appsItem);

            // Power Options (gnome-control-center power)
            const powerItem = new PopupMenu.PopupMenuItem(_('Power Options'));
            powerItem.connect('activate', () => {
                try {
                    Gio.Subprocess.new(['gnome-control-center', 'power'], Gio.SubprocessFlags.NONE);
                } catch (e) { /* ignore */ }
            });
            this._startContextMenu.addMenuItem(powerItem);

            // Event Viewer (journalctl)
            const eventItem = new PopupMenu.PopupMenuItem(_('Event Viewer'));
            eventItem.connect('activate', () => {
                try {
                    Gio.Subprocess.new(['gnome-logs'], Gio.SubprocessFlags.NONE);
                } catch (e) {
                    try {
                        Gio.Subprocess.new(['gnome-terminal', '--', 'journalctl', '-f'], Gio.SubprocessFlags.NONE);
                    } catch (e2) { /* ignore */ }
                }
            });
            this._startContextMenu.addMenuItem(eventItem);

            // Device Manager
            const deviceItem = new PopupMenu.PopupMenuItem(_('Device Manager'));
            deviceItem.connect('activate', () => {
                try {
                    Gio.Subprocess.new(['hardinfo'], Gio.SubprocessFlags.NONE);
                } catch (e) {
                    try {
                        Gio.Subprocess.new(['gnome-control-center', 'info-overview'], Gio.SubprocessFlags.NONE);
                    } catch (e2) { /* ignore */ }
                }
            });
            this._startContextMenu.addMenuItem(deviceItem);

            // Network Connections
            const networkItem = new PopupMenu.PopupMenuItem(_('Network Connections'));
            networkItem.connect('activate', () => {
                try {
                    Gio.Subprocess.new(['gnome-control-center', 'network'], Gio.SubprocessFlags.NONE);
                } catch (e) {
                    try {
                        Gio.Subprocess.new(['nm-connection-editor'], Gio.SubprocessFlags.NONE);
                    } catch (e2) { /* ignore */ }
                }
            });
            this._startContextMenu.addMenuItem(networkItem);

            // Disk Management
            const diskItem = new PopupMenu.PopupMenuItem(_('Disk Management'));
            diskItem.connect('activate', () => {
                try {
                    Gio.Subprocess.new(['gnome-disks'], Gio.SubprocessFlags.NONE);
                } catch (e) { /* ignore */ }
            });
            this._startContextMenu.addMenuItem(diskItem);

            this._startContextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Terminal
            const terminalItem = new PopupMenu.PopupMenuItem(_('Terminal'));
            terminalItem.connect('activate', () => {
                const terminals = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'tilix', 'terminator', 'xterm'];
                for (const term of terminals) {
                    try {
                        Gio.Subprocess.new([term], Gio.SubprocessFlags.NONE);
                        break;
                    } catch (e) { continue; }
                }
            });
            this._startContextMenu.addMenuItem(terminalItem);

            // Terminal (Admin)
            const terminalAdminItem = new PopupMenu.PopupMenuItem(_('Terminal (Administrator)'));
            terminalAdminItem.connect('activate', () => {
                const terminals = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'tilix', 'terminator', 'xterm'];
                for (const term of terminals) {
                    try {
                        Gio.Subprocess.new(['pkexec', term], Gio.SubprocessFlags.NONE);
                        break;
                    } catch (e) { continue; }
                }
            });
            this._startContextMenu.addMenuItem(terminalAdminItem);

            this._startContextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Task Manager
            const taskManagerItem = new PopupMenu.PopupMenuItem(_('Task Manager'));
            taskManagerItem.connect('activate', () => {
                try {
                    Gio.Subprocess.new(['gnome-system-monitor'], Gio.SubprocessFlags.NONE);
                } catch (e) {
                    try {
                        Gio.Subprocess.new(['gnome-usage'], Gio.SubprocessFlags.NONE);
                    } catch (e2) { /* ignore */ }
                }
            });
            this._startContextMenu.addMenuItem(taskManagerItem);

            // Settings
            const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
            settingsItem.connect('activate', () => {
                const app = Shell.AppSystem.get_default().lookup_app('gnome-control-center.desktop');
                if (app) {
                    app.activate();
                } else {
                    try {
                        Gio.Subprocess.new(['gnome-control-center'], Gio.SubprocessFlags.NONE);
                    } catch (e) { /* ignore */ }
                }
            });
            this._startContextMenu.addMenuItem(settingsItem);

            // File Explorer
            const explorerItem = new PopupMenu.PopupMenuItem(_('File Explorer'));
            explorerItem.connect('activate', () => {
                const app = Shell.AppSystem.get_default().lookup_app('org.gnome.Nautilus.desktop');
                if (app) {
                    app.activate();
                } else {
                    try {
                        Gio.Subprocess.new(['nautilus'], Gio.SubprocessFlags.NONE);
                    } catch (e) { /* ignore */ }
                }
            });
            this._startContextMenu.addMenuItem(explorerItem);

            // Search
            const searchItem = new PopupMenu.PopupMenuItem(_('Search'));
            searchItem.connect('activate', () => {
                Main.overview.show();
            });
            this._startContextMenu.addMenuItem(searchItem);

            // Run
            const runItem = new PopupMenu.PopupMenuItem(_('Run'));
            runItem.connect('activate', () => {
                Main.openRunDialog();
            });
            this._startContextMenu.addMenuItem(runItem);

            this._startContextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Shutdown submenu
            const shutdownItem = new PopupMenu.PopupSubMenuMenuItem(_('Shut down or sign out'));

            const logoutItem = new PopupMenu.PopupMenuItem(_('Sign out'));
            logoutItem.connect('activate', () => {
                SystemActions.getDefault().activateLogout();
            });
            shutdownItem.menu.addMenuItem(logoutItem);

            const suspendItem = new PopupMenu.PopupMenuItem(_('Sleep'));
            suspendItem.connect('activate', () => {
                SystemActions.getDefault().activateSuspend();
            });
            shutdownItem.menu.addMenuItem(suspendItem);

            const restartItem = new PopupMenu.PopupMenuItem(_('Restart'));
            restartItem.connect('activate', () => {
                SystemActions.getDefault().activateRestart();
            });
            shutdownItem.menu.addMenuItem(restartItem);

            const powerOffItem = new PopupMenu.PopupMenuItem(_('Shut down'));
            powerOffItem.connect('activate', () => {
                SystemActions.getDefault().activatePowerOff();
            });
            shutdownItem.menu.addMenuItem(powerOffItem);

            this._startContextMenu.addMenuItem(shutdownItem);

            // Desktop
            const desktopItem = new PopupMenu.PopupMenuItem(_('Desktop'));
            desktopItem.connect('activate', () => {
                // Show desktop by minimizing all windows
                global.get_window_actors().forEach(actor => {
                    const win = actor.get_meta_window();
                    if (win && win.can_minimize() && !win.minimized) {
                        win.minimize();
                    }
                });
            });
            this._startContextMenu.addMenuItem(desktopItem);

            // Connect right-click handler to start button
            this._startButton.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 3) { // Right click
                    this._startContextMenu.toggle();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _updateStartButtonIcon() {
            const style = this._settings.get_enum('start-button-style');
            const customIcon = this._settings.get_string('custom-start-icon');

            // 0 = default, 1 = gnome, 2 = custom
            if (style === 2 && customIcon && customIcon.length > 0) {
                // Custom icon
                try {
                    const file = Gio.File.new_for_path(customIcon);
                    if (file.query_exists(null)) {
                        this._startButtonIcon.set_gicon(new Gio.FileIcon({ file }));
                    } else {
                        // Fallback if file doesn't exist
                        this._startButtonIcon.set_icon_name('start-here-symbolic');
                    }
                } catch (e) {
                    log(`[Winbar] Could not load custom icon: ${e.message}`);
                    this._startButtonIcon.set_icon_name('start-here-symbolic');
                }
            } else if (style === 1) {
                // GNOME style
                this._startButtonIcon.set_icon_name('view-app-grid-symbolic');
            } else {
                // Default style (default)
                this._startButtonIcon.set_icon_name('start-here-symbolic');
            }
        }

        _updateAnimations() {
            const enabled = this._settings.get_boolean('enable-animations');
            const duration = this._settings.get_int('animation-duration');

            // Apply animation settings via CSS classes
            if (enabled) {
                this.remove_style_class_name('winbar-no-animations');
                // Update transition durations dynamically for animated elements
                const durationStyle = `transition-duration: ${duration}ms;`;
                this._appButtons.forEach(button => {
                    button.set_style(durationStyle);
                });
            } else {
                this.add_style_class_name('winbar-no-animations');
            }
        }

        _updateSpacing() {
            // Get all spacing values
            const startSpacing = this._settings.get_int('start-button-spacing');
            const searchSpacing = this._settings.get_int('search-spacing');
            const taskviewSpacing = this._settings.get_int('taskview-spacing');
            const appSpacing = this._settings.get_int('app-icon-spacing');
            const traySpacing = this._settings.get_int('system-tray-spacing');
            const clockSpacing = this._settings.get_int('clock-spacing');

            // Apply spacing to buttons via margin
            this._startButton.set_style(`margin: 0 ${startSpacing}px;`);
            this._searchButton.set_style(`margin: 0 ${searchSpacing}px;`);
            this._taskViewButton.set_style(`margin: 0 ${taskviewSpacing}px;`);
            this._clockButton.set_style(`margin: 0 ${clockSpacing}px;`);

            // Apply spacing to app container
            this._appContainer.set_style(`spacing: ${appSpacing}px;`);

            // Apply spacing to system tray
            this._systemTray.set_style(`spacing: ${traySpacing}px;`);
        }

        _updateIconSize() {
            const iconSize = this._settings.get_int('icon-size');
            // Update all app button icons
            this._appButtons.forEach(button => {
                if (button._icon) {
                    button._icon.set_icon_size(iconSize);
                }
            });
        }

        _onSettingChanged(key) {
            switch (key) {
                // Visibility settings
                case 'show-widgets':
                    this._widgetsButton.visible = this._settings.get_boolean('show-widgets');
                    break;
                case 'show-start-button':
                    this._startButton.visible = this._settings.get_boolean('show-start-button');
                    break;
                case 'show-search':
                    this._searchButton.visible = this._settings.get_boolean('show-search');
                    break;
                case 'show-task-view':
                    this._taskViewButton.visible = this._settings.get_boolean('show-task-view');
                    break;
                case 'show-system-tray':
                    this._systemTray.visible = this._settings.get_boolean('show-system-tray');
                    break;
                case 'show-clock':
                    this._clockButton.visible = this._settings.get_boolean('show-clock');
                    break;
                case 'show-notifications':
                    this._notificationButton.visible = this._settings.get_boolean('show-notifications');
                    break;
                case 'show-show-desktop':
                    this._showDesktopButton.visible = this._settings.get_boolean('show-show-desktop');
                    break;

                // App display settings
                case 'show-favorites':
                case 'show-running-apps':
                case 'isolate-workspaces':
                case 'isolate-monitors':
                case 'group-apps':
                    this._refreshApps();
                    break;

                // Style settings
                case 'panel-opacity':
                case 'border-radius':
                case 'theme-mode':
                case 'panel-padding-horizontal':
                case 'panel-padding-vertical':
                case 'blur-effect':
                case 'blur-strength':
                    this._updatePanelStyle();
                    if (this._startMenu) {
                        this._startMenu.updateTheme();
                    }
                    if (this._searchButton) {
                        this._searchButton.updateTheme();
                    }
                    if (this._clockButton) {
                        this._clockButton.updateTheme();
                    }
                    if (this._notificationButton) {
                        this._notificationButton.updateTheme();
                    }
                    if (this._systemTray) {
                        this._systemTray.updateTheme();
                    }
                    break;

                // Spacing settings
                case 'start-button-spacing':
                case 'search-spacing':
                case 'taskview-spacing':
                case 'app-icon-spacing':
                case 'system-tray-spacing':
                case 'clock-spacing':
                    this._updateSpacing();
                    break;

                // Icon size
                case 'icon-size':
                    this._updateIconSize();
                    this._refreshApps();
                    break;

                // Search style
                case 'search-style':
                    this._searchButton.updateStyle();
                    break;

                // Clock settings
                case 'clock-format':
                case 'show-date':
                    this._clockButton.updateSettings();
                    break;

                // Center items
                case 'center-taskbar-items':
                    this._updateCenterAlignment();
                    break;

                // Indicator settings
                case 'running-indicator-style':
                case 'indicator-position':
                    this._updateAppIndicators();
                    break;

                // Start button icon
                case 'start-button-style':
                case 'custom-start-icon':
                    this._updateStartButtonIcon();
                    break;

                // Animation settings
                case 'enable-animations':
                case 'animation-duration':
                    this._updateAnimations();
                    break;

                // System tray settings
                case 'tray-icon-limit':
                case 'show-tray-chevron':
                    if (this._systemTray) {
                        this._systemTray.updateSettings();
                    }
                    break;
            }
        }


        _shouldShowApp(app) {
            const windows = app.get_windows();
            if (windows.length === 0) {
                return true; // Show pinned apps even with no windows
            }

            const isolateWorkspaces = this._settings.get_boolean('isolate-workspaces');
            const isolateMonitors = this._settings.get_boolean('isolate-monitors');

            if (!isolateWorkspaces && !isolateMonitors) {
                return true; // No filtering needed
            }

            const activeWorkspace = global.workspace_manager.get_active_workspace();
            const currentMonitor = this._monitor;

            // Check if any window matches our filters
            return windows.some(window => {
                if (isolateWorkspaces && window.get_workspace() !== activeWorkspace) {
                    return false;
                }
                if (isolateMonitors && window.get_monitor() !== currentMonitor.index) {
                    return false;
                }
                return true;
            });
        }

        _refreshApps() {
            // Clear existing buttons
            this._appContainer.destroy_all_children();
            this._appButtons = new Map();
            this._windowButtons = new Map();  // Track orphan windows by wmClass (Wine/Lutris apps)
            this._windowToWmClass = new Map();  // Map window stable_sequence to wmClass for cleanup

            // Add pinned apps (in saved order)
            if (this._settings.get_boolean('show-favorites')) {
                const favorites = AppFavorites.getAppFavorites().getFavorites();
                favorites.forEach(app => {
                    if (this._shouldShowApp(app)) {
                        this._addAppButton(app);
                    }
                });
            }

            // Add running apps that aren't pinned
            if (this._settings.get_boolean('show-running-apps')) {
                const running = Shell.AppSystem.get_default().get_running();
                running.forEach(app => {
                    // Only add if it has actual non-skipped windows and isn't already shown
                    const windows = app.get_windows().filter(w =>
                        !w.is_skip_taskbar() && !this._shouldSkipWindow(w)
                    );
                    if (windows.length > 0 && !this._appButtons.has(app.get_id()) && this._shouldShowApp(app)) {
                        this._addAppButton(app);
                    }
                });

                // Also check for orphan windows (Wine/Lutris apps without .desktop files)
                this._addOrphanWindows();
            }
        }

        /**
         * Find and add windows that don't have an associated app (Wine/Lutris/Proton)
         */
        _addOrphanWindows() {
            const workspace = global.workspace_manager.get_active_workspace();
            const windows = workspace.list_windows();

            windows.forEach(window => {
                if (window.is_skip_taskbar()) return;

                // Check if this window has an app
                const app = Shell.WindowTracker.get_default().get_window_app(window);
                if (app) return;  // Has app, handled by normal flow

                // Check window type - only handle NORMAL windows
                const windowType = window.get_window_type();
                if (windowType !== Meta.WindowType.NORMAL) return;

                // Skip Lutris/Wine tray windows (small utility windows for tray icons)
                if (this._shouldSkipWindow(window)) return;

                // This is an orphan window - add it
                this._addWindowButton(window);
            });
        }

        /**
         * Check if a window should be hidden from taskbar (Lutris/Wine tray, Unknown Window, Steam helpers)
         */
        _shouldSkipWindow(window) {
            try {
                const wmClass = window.get_wm_class();
                const title = window.get_title();
                const frame = window.get_frame_rect();

                // 1. Filter "Unknown Window"
                if (title === "Unknown Window") {
                    return true;
                }

                if (wmClass) {
                    const wmClassLower = wmClass.toLowerCase();

                    // 2. Filter Steam helper windows (steam_app_*, steam_apps_* - often tray icons or hidden helpers)
                    if (wmClassLower.startsWith('steam_app_') || wmClassLower.startsWith('steam_apps_')) {
                        return true;
                    }

                    // 3. Lutris/Wine tray windows logic
                    // Lutris/Wine tray windows are typically very small
                    const isSmall = frame.width < 300 && frame.height < 100;
                    if (isSmall) {
                        // Lutris tray indicator
                        if (wmClassLower.includes('lutris') &&
                            (frame.width < 200 || (title && title.toLowerCase().includes('tray')))) {
                            return true;
                        }

                        // Wine tray windows
                        if ((wmClassLower === 'wine' || wmClassLower.startsWith('.wine-')) &&
                            frame.width < 200 && frame.height < 50) {
                            return true;
                        }
                    }
                }

                return false;
            } catch (e) {
                return false;
            }
        }

        _addWindowButton(window) {
            // Group orphan windows by wmClass
            const wmClass = window.get_wm_class() || `window-${window.get_stable_sequence()}`;
            const windowId = window.get_stable_sequence();

            // Track which wmClass this window belongs to (for cleanup)
            if (!this._windowToWmClass) {
                this._windowToWmClass = new Map();
            }
            this._windowToWmClass.set(windowId, wmClass);

            // Check if we already have a button for this wmClass
            if (this._windowButtons.has(wmClass)) {
                // Add window to existing button
                const existingButton = this._windowButtons.get(wmClass);
                if (existingButton && existingButton.addWindow) {
                    existingButton.addWindow(window);
                }
                return;
            }

            const button = new WindowButton(window, this._extension, this);
            this._appContainer.add_child(button);
            this._windowButtons.set(wmClass, button);
        }

        _getWindowButtonKey(window) {
            // Get the key used to store this window's button (use tracked value if available)
            const windowId = window.get_stable_sequence();
            if (this._windowToWmClass?.has(windowId)) {
                return this._windowToWmClass.get(windowId);
            }
            return window.get_wm_class() || `window-${windowId}`;
        }

        acceptDrop(source) {
            return source instanceof TaskbarButton;
        }

        handleDragOver(source, actor, x, y) {
            if (!(source instanceof TaskbarButton)) {
                return DND.DragMotionResult.NO_DROP;
            }

            const children = this._appContainer.get_children();
            const sourceIndex = children.indexOf(source);

            if (sourceIndex === -1) {
                return DND.DragMotionResult.NO_DROP;
            }

            let targetIndex = children.length;
            let accumulatedX = 0;

            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                if (child === source) {
                    accumulatedX += child.get_width();
                    continue;
                }

                const childWidth = child.get_width();
                const midpoint = accumulatedX + childWidth / 2;

                if (x < midpoint) {
                    targetIndex = i;
                    break;
                }
                accumulatedX += childWidth;
            }

            if (sourceIndex < targetIndex) {
                targetIndex--;
            }

            if (sourceIndex !== targetIndex) {
                this._appContainer.set_child_at_index(source, targetIndex);
            }

            this._dragTargetIndex = targetIndex;
            return DND.DragMotionResult.MOVE_DROP;
        }

        handleDrop(source) {

            if (!(source instanceof TaskbarButton)) {
                log(`[Winbar DND] Winbar.handleDrop REJECTED`);
                return false;
            }

            this._persistFavoritesOrder();
            return true;
        }

        _persistFavoritesOrder() {
            if (this._isReorderingApps) {
                return;
            }

            const children = this._appContainer.get_children();

            const favorites = AppFavorites.getAppFavorites();
            const currentFavoriteMap = favorites.getFavoriteMap();

            const newOrder = [];
            for (const child of children) {
                if (child instanceof TaskbarButton) {
                    const appId = child.getApp().get_id();
                    if (currentFavoriteMap[appId]) {
                        newOrder.push(appId);
                    }
                }
            }

            if (this._favoritesId) {
                favorites.disconnect(this._favoritesId);
            }

            for (let i = 0; i < newOrder.length; i++) {
                favorites.moveFavoriteToPos(newOrder[i], i);
            }

            this._favoritesId = favorites.connect('changed', () => {
                if (!this._isReorderingApps) {
                    this._refreshApps();
                }
            });
        }

        _addAppButton(app) {
            const button = new TaskbarButton(app, this._extension, this);
            this._appContainer.add_child(button);
            this._appButtons.set(app.get_id(), button);
        }

        _updateAppIndicators() {
            // Update all app button indicators with new style/position
            this._appButtons.forEach(button => {
                button._updateIndicatorPosition();
                button._updateIndicatorStyle();
            });
            // Also update window button indicators
            if (this._windowButtons) {
                this._windowButtons.forEach(button => {
                    if (button._updateIndicatorPosition) {
                        button._updateIndicatorPosition();
                    }
                });
            }
        }

        _onWindowAdded(window) {
            try {
                if (!window || window.is_skip_taskbar())
                    return;

                // Check window type - only handle NORMAL windows
                const windowType = window.get_window_type();
                if (windowType !== Meta.WindowType.NORMAL)
                    return;

                const wmClass = window.get_wm_class() || 'unknown';
                const title = window.get_title() || 'untitled';
                const app = Shell.WindowTracker.get_default().get_window_app(window);
                const appId = app?.get_id() || 'null';

                // Check if this is a fake "window:X" placeholder app - these are not real apps
                // WindowTracker creates these for windows without proper .desktop associations
                const isFakeApp = appId.startsWith('window:');

                // If we have a properly identified app (not a fake window:X app), always handle it
                // This covers Electron apps like VS Code that may initially have unknown wmClass
                if (app && !isFakeApp) {
                    // Normal app with .desktop file
                    if (!this._appButtons.has(app.get_id())) {
                        this._addAppButton(app);
                    }

                    this._updateAppStates();

                    // Track window closed
                    window.connect('unmanaged', () => {
                        if (this._isDestroyed) return;
                        this._onWindowRemoved(app);
                    });
                } else if (isFakeApp) {
                    // Fake window:X app - typically Wine/Proton apps or loading windows
                    // For windows with unknown wmClass and no title, schedule delayed check
                    // They might get proper values later (e.g., Electron apps during startup)
                    if (wmClass === 'unknown' && (!title || title === 'untitled')) {
                        this._scheduleOrphanWindowCheck(window);
                        return;
                    }
                    this._scheduleOrphanWindowCheck(window);
                } else {
                    // No app found at all - Wine/Lutris/Proton app without .desktop file
                    // For windows with unknown wmClass and no title, schedule delayed check
                    if (wmClass === 'unknown' && (!title || title === 'untitled')) {
                        this._scheduleOrphanWindowCheck(window);
                        return;
                    }
                    log(`[Winbar] No app found, scheduling orphan check`);
                    this._scheduleOrphanWindowCheck(window);
                }
            } catch (e) {
                log(`[Winbar] Error in _onWindowAdded: ${e.message}`);
                logError(e, 'Winbar _onWindowAdded');
            }
        }

        _scheduleOrphanWindowCheck(window) {
            // Check multiple times with increasing delays
            // Electron/CEF apps can take several seconds to be recognized
            const checkDelays = ORPHAN_CHECK_DELAYS;
            let checkIndex = 0;

            const doCheck = () => {
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;

                try {
                    // Window may have been closed
                    if (!window || window.is_skip_taskbar()) {
                        return GLib.SOURCE_REMOVE;
                    }

                    // Skip transient/loading windows that never got proper info
                    const currentWmClass = window.get_wm_class() || 'unknown';
                    const currentTitle = window.get_title() || 'untitled';
                    if (currentWmClass === 'unknown' && (!currentTitle || currentTitle === 'untitled')) {
                        return GLib.SOURCE_REMOVE;
                    }

                    const app = Shell.WindowTracker.get_default().get_window_app(window);
                    const appId = app?.get_id() || 'null';
                    const isFakeApp = appId.startsWith('window:');

                    // Only consider it a real app if it's not a fake window:X app
                    if (app && !isFakeApp) {
                        // Window now has an app - add it normally
                        if (!this._appButtons.has(app.get_id())) {
                            this._addAppButton(app);
                        }

                        // Remove any orphan WindowButton that was created (use tracked wmClass)
                        const windowId = window.get_stable_sequence();
                        const trackedWmClass = this._windowToWmClass?.get(windowId);
                        if (trackedWmClass) {
                            const existingBtn = this._windowButtons?.get(trackedWmClass);
                            if (existingBtn) {
                                const shouldDestroy = existingBtn.removeWindow(window);
                                if (shouldDestroy) {
                                    existingBtn.destroy();
                                    this._windowButtons.delete(trackedWmClass);
                                }
                            }
                            this._windowToWmClass.delete(windowId);
                        }

                        this._updateAppStates();

                        // Track window closed
                        window.connect('unmanaged', () => {
                            if (this._isDestroyed) return;
                            this._onWindowRemoved(app);
                        });

                        return GLib.SOURCE_REMOVE;
                    }

                    // Still no real app - try again or give up
                    checkIndex++;
                    if (checkIndex < checkDelays.length) {
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, checkDelays[checkIndex], doCheck);
                        return GLib.SOURCE_REMOVE;
                    }

                    // All checks exhausted - this is truly an orphan window
                    // Skip Lutris/Wine tray windows
                    if (this._shouldSkipWindow(window)) {
                        return GLib.SOURCE_REMOVE;
                    }

                    // Only add WindowButton for Wine/Proton apps (steam_app_*, lutris_*, etc.)
                    // Skip windows that still have unknown wmClass - they're likely transient
                    if (currentWmClass === 'unknown') {
                        return GLib.SOURCE_REMOVE;
                    }

                    // Only add if it doesn't already exist
                    const windowId = `window-${window.get_stable_sequence()}`;
                    if (!this._windowButtons?.has(windowId)) {
                        this._addWindowButton(window);

                        // Track window closed
                        window.connect('unmanaged', () => {
                            if (this._isDestroyed) return;
                            this._onOrphanWindowRemoved(window);
                        });

                        // Also monitor for when this window eventually gets an app
                        this._monitorWindowForAppAssociation(window);
                    }

                    this._updateAppStates();
                } catch (e) {
                    log(`[Winbar] Error in orphan check: ${e.message}`);
                    logError(e, 'Winbar orphan check');
                }

                return GLib.SOURCE_REMOVE;
            };

            // Start with first delay
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, checkDelays[0], doCheck);
        }

        _monitorWindowForAppAssociation(window) {
            // Periodically check if the window gets an app association
            // This handles cases where the app takes a very long time to be recognized
            let checkCount = 0;
            const maxChecks = APP_ASSOCIATION_MAX_CHECKS;

            const checkForApp = () => {
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;

                try {
                    if (!window || window.is_skip_taskbar()) {
                        return GLib.SOURCE_REMOVE;
                    }

                    const app = Shell.WindowTracker.get_default().get_window_app(window);
                    const appId = app?.get_id() || 'null';
                    const isFakeApp = appId.startsWith('window:');

                    // Only consider it a real app if it's not a fake window:X app
                    if (app && !isFakeApp) {
                        // Window now has an app!
                        // Add the proper app button
                        if (!this._appButtons.has(app.get_id())) {
                            this._addAppButton(app);
                        }

                        // Remove the orphan WindowButton (use tracked wmClass)
                        const windowId = window.get_stable_sequence();
                        const trackedWmClass = this._windowToWmClass?.get(windowId);
                        if (trackedWmClass) {
                            const existingBtn = this._windowButtons?.get(trackedWmClass);
                            if (existingBtn) {
                                const shouldDestroy = existingBtn.removeWindow(window);
                                if (shouldDestroy) {
                                    existingBtn.destroy();
                                    this._windowButtons.delete(trackedWmClass);
                                }
                            }
                            this._windowToWmClass.delete(windowId);
                        }

                        this._updateAppStates();
                        return GLib.SOURCE_REMOVE;
                    }

                    checkCount++;
                    if (checkCount >= maxChecks) {
                        return GLib.SOURCE_REMOVE;
                    }

                    return GLib.SOURCE_CONTINUE;
                } catch (e) {
                    log(`[Winbar] Error in app association monitor: ${e.message}`);
                    logError(e, 'Winbar app association monitor');
                    return GLib.SOURCE_REMOVE;
                }
            };

            // Check periodically for app association
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, APP_ASSOCIATION_CHECK_INTERVAL_MS, checkForApp);
        }

        _onOrphanWindowRemoved(window) {
            // Get the window ID before it's destroyed
            const windowId = window.get_stable_sequence();

            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WINDOW_REMOVAL_DELAY_MS, () => {
                if (this._isDestroyed || !this._windowButtons) {
                    return GLib.SOURCE_REMOVE;
                }

                const index = this._windowRemovalTimeouts.indexOf(timeoutId);
                if (index > -1) {
                    this._windowRemovalTimeouts.splice(index, 1);
                }

                // Use tracked wmClass (stored when window was added)
                const wmClass = this._windowToWmClass?.get(windowId);
                if (!wmClass) {
                    log(`[Winbar] No tracked wmClass for window ${windowId}`);
                    return GLib.SOURCE_REMOVE;
                }

                // Clean up tracking
                this._windowToWmClass.delete(windowId);

                const button = this._windowButtons.get(wmClass);
                if (button) {
                    // Remove this specific window from the button
                    const shouldDestroy = button.removeWindow(window);
                    if (shouldDestroy) {
                        button.destroy();
                        this._windowButtons.delete(wmClass);
                    }
                }

                this._updateAppStates();
                return GLib.SOURCE_REMOVE;
            });
            this._windowRemovalTimeouts.push(timeoutId);
        }

        _onWindowRemoved(app) {
            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WINDOW_REMOVAL_DELAY_MS, () => {
                // Guard against disposed panel
                if (this._isDestroyed || !this._appButtons) {
                    return GLib.SOURCE_REMOVE;
                }

                // Remove this timeout from tracking array
                const index = this._windowRemovalTimeouts.indexOf(timeoutId);
                if (index > -1) {
                    this._windowRemovalTimeouts.splice(index, 1);
                }

                // Only count windows that should appear in taskbar
                const windows = app.get_windows().filter(w => !w.is_skip_taskbar());
                const isPinned = AppFavorites.getAppFavorites().isFavorite(app.get_id());

                if (windows.length === 0 && !isPinned) {
                    const button = this._appButtons.get(app.get_id());
                    if (button) {
                        button.destroy();
                        this._appButtons.delete(app.get_id());
                    }
                }

                this._updateAppStates();
                return GLib.SOURCE_REMOVE;
            });
            // Track timeout for cleanup on destroy
            this._windowRemovalTimeouts.push(timeoutId);
        }

        _updateAppStates() {
            if (!this._appButtons || this._isDestroyed) return;
            this._appButtons.forEach(button => {
                // Guard against disposed buttons
                try {
                    if (button && !button._isDestroyed && button._indicator) {
                        button._updateState();
                    }
                } catch (e) {
                    // Button may have been disposed
                }
            });

            // Also update WindowButtons for orphan windows
            if (this._windowButtons) {
                this._windowButtons.forEach(button => {
                    try {
                        if (button && !button._isDestroyed && button._updateState) {
                            button._updateState();
                        }
                    } catch (e) {
                        // Button may have been disposed
                    }
                });
            }
        }

        destroy() {
            // Mark as destroyed to prevent callbacks on disposed objects
            this._isDestroyed = true;

            // Cancel any pending window removal timeouts
            if (this._windowRemovalTimeouts) {
                this._windowRemovalTimeouts.forEach(timeoutId => {
                    try { GLib.source_remove(timeoutId); } catch (e) { /* Source may already be removed */ }
                });
                this._windowRemovalTimeouts = [];
            }

            // Cancel window cleanup timer
            if (this._windowCleanupTimerId) {
                try { GLib.source_remove(this._windowCleanupTimerId); } catch (e) { /* Source may already be removed */ }
                this._windowCleanupTimerId = null;
            }

            // Disconnect signals first
            if (this._appSystemId) {
                try { Shell.AppSystem.get_default().disconnect(this._appSystemId); } catch (e) { /* Signal may already be disconnected */ }
                this._appSystemId = null;
            }
            if (this._favoritesId) {
                try { AppFavorites.getAppFavorites().disconnect(this._favoritesId); } catch (e) { /* Signal may already be disconnected */ }
                this._favoritesId = null;
            }
            if (this._windowAddedId) {
                try { global.display.disconnect(this._windowAddedId); } catch (e) { /* Signal may already be disconnected */ }
                this._windowAddedId = null;
            }
            if (this._focusWindowId) {
                try { global.display.disconnect(this._focusWindowId); } catch (e) { /* Signal may already be disconnected */ }
                this._focusWindowId = null;
            }
            if (this._settingsChangedId) {
                try { this._settings.disconnect(this._settingsChangedId); } catch (e) { /* Signal may already be disconnected */ }
                this._settingsChangedId = null;
            }
            if (this._sessionModeId) {
                try { Main.sessionMode.disconnect(this._sessionModeId); } catch (e) { /* Signal may already be disconnected */ }
                this._sessionModeId = null;
            }
            if (this._fullscreenChangedId) {
                try { global.display.disconnect(this._fullscreenChangedId); } catch (e) { /* Signal may already be disconnected */ }
                this._fullscreenChangedId = null;
            }
            if (this._workspaceSwitchedId) {
                try { global.workspace_manager.disconnect(this._workspaceSwitchedId); } catch (e) { /* Signal may already be disconnected */ }
                this._workspaceSwitchedId = null;
            }
            if (this._interfaceSettingsId && this._interfaceSettings) {
                try { this._interfaceSettings.disconnect(this._interfaceSettingsId); } catch (e) { /* Signal may already be disconnected */ }
                this._interfaceSettings = null;
                this._interfaceSettingsId = null;
            }

            // Remove blur effect
            if (this._blurEffect) {
                try { this.remove_effect(this._blurEffect); } catch (e) { /* Effect may already be removed */ }
                this._blurEffect = null;
            }

            // Disconnect captured event handler
            if (this._capturedEventId) {
                try { global.stage.disconnect(this._capturedEventId); } catch (e) { /* Handler may already be disconnected */ }
                this._capturedEventId = null;
            }

            // Destroy context menu
            if (this._contextMenu) {
                try { this._contextMenu.destroy(); } catch (e) { /* Actor may already be destroyed */ }
                this._contextMenu = null;
            }

            // Destroy start menu
            if (this._startMenu) {
                try {
                    this._startMenu.hide();
                    Main.layoutManager.removeChrome(this._startMenu);
                } catch (e) { /* Actor may already be destroyed */ }
                this._startMenu = null;
            }

            // Destroy search dialog
            if (this._searchButton && this._searchButton._searchDialog) {
                try {
                    this._searchButton._searchDialog.close();
                    this._searchButton._searchDialog.destroy();
                } catch (e) { /* Actor may already be destroyed */ }
                this._searchButton._searchDialog = null;
            }

            // Cleanup clock button before destroy
            if (this._clockButton) {
                try {
                    if (this._clockButton.cleanup) {
                        this._clockButton.cleanup();
                    }
                } catch (e) { /* Actor may already be destroyed */ }
            }

            // Clear app buttons
            if (this._appButtons) {
                this._appButtons.forEach(button => {
                    try { button.destroy(); } catch (e) { /* Actor may already be destroyed */ }
                });
                this._appButtons.clear();
            }

            // Clear window buttons (orphan windows)
            if (this._windowButtons) {
                this._windowButtons.forEach(button => {
                    try { button.destroy(); } catch (e) { /* Actor may already be destroyed */ }
                });
                this._windowButtons.clear();
            }

            // Clear references
            this._extension = null;
            this._settings = null;

            super.destroy();
        }
    });
