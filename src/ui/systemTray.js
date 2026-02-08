import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gvc from 'gi://Gvc';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { getEffectiveThemeMode, addBlurEffect } from '../utils.js';
import {
    ANIMATION_TIME,
    TRAY_PERIODIC_CHECK_INTERVAL_SECONDS,
    TRAY_CLONE_VALIDATION_INTERVAL_SECONDS,
    MENU_OFFSET_PX,
    MENU_SCREEN_PADDING_PX,
    THEME_COLORS,
} from '../constants.js';

/**
 * TrayManager - Singleton to manage hijacked tray items across monitors
 */
const TrayManager = GObject.registerClass({
    Signals: {
        'item-added': { param_types: [GObject.TYPE_STRING, GObject.TYPE_OBJECT] },
        'item-removed': { param_types: [GObject.TYPE_STRING] },
    },
}, class TrayManager extends GObject.Object {
    _init() {
        super._init();
        this._items = new Map();
        this._injectionManager = new InjectionManager();
        this._setupBoxPointerInjection();
    }

    _setupBoxPointerInjection() {
        // Override BoxPointer's _updatePosition to handle winbar-managed menus
        this._injectionManager.overrideMethod(
            BoxPointer.BoxPointer.prototype,
            '_updatePosition',
            originalMethod => {
                return function() {
                    // Call original positioning first
                    originalMethod.call(this);

                    // If this BoxPointer is marked as winbar-managed, reposition to the correct monitor
                    if (this._winbarInPanel && this._winbarTargetMonitor && this.sourceActor) {
                        const targetMon = this._winbarTargetMonitor;
                        const [sX, sY] = this.sourceActor.get_transformed_position();
                        const [sW, sH] = this.sourceActor.get_size();
                        const [mW, mH] = this.get_size();

                        if (mW > 0 && mH > 0) {
                            // Calculate position centered above the source actor
                            let x = sX + sW / 2 - mW / 2;
                            let y = sY - mH - MENU_OFFSET_PX;

                            // Constrain to target monitor's bounds
                            if (x < targetMon.x) x = targetMon.x + 4;
                            if (x + mW > targetMon.x + targetMon.width) x = targetMon.x + targetMon.width - mW - 4;
                            if (y < targetMon.y) y = sY + sH + 4; // Position below if no room above
                            if (y + mH > targetMon.y + targetMon.height) y = targetMon.y + targetMon.height - mH - 4;

                            this.set_position(Math.floor(x), Math.floor(y));
                        }
                    }
                };
            }
        );
    }

    registerItem(id, item, actor) {
        if (this._items.has(id)) return;

        this._items.set(id, { item, actor });
        this.emit('item-added', id, actor);
    }

    unregisterItem(id) {
        if (this._items.has(id)) {
            this._items.delete(id);
            this.emit('item-removed', id);
        }
    }

    getItem(id) {
        return this._items.get(id);
    }

    getItems() {
        return this._items;
    }

    destroy() {
        this._injectionManager.clear();
        this._items.clear();
    }
});

// Singleton instance
export const trayManager = new TrayManager();

/**
 * SystemTray - System tray with Quick Settings
 */
export const SystemTray = GObject.registerClass({
    GTypeName: 'WinbarSystemTray',
},
    class SystemTray extends St.Button {
        _init(extension, winbar) {
            super._init({
                style_class: 'winbar-system-tray',
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            this._extension = extension;
            this._winbar = winbar;
            this._toggleStates = {};
            this._hijackedItems = new Map(); // Keep track of items we stole from Main.panel
            this._clonedItems = new Map();   // Keep track of clones on secondary monitors
            this._isDestroyed = false;
            this._pendingIdleSources = new Set(); // Track deferred callbacks for cleanup

            // Determine if we are on the primary monitor
            this._isPrimary = (this._winbar._monitor.index === Main.layoutManager.primaryIndex);

            // Main container
            this._box = new St.BoxLayout({
                style_class: 'winbar-tray-box',
            });
            this.set_child(this._box);

            // Hidden icons button (chevron)
            this._hiddenIconsBtn = new St.Button({
                style_class: 'winbar-tray-chevron',
                child: new St.Icon({
                    icon_name: 'pan-up-symbolic',
                    icon_size: 16,
                }),
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            this._hiddenIconsBtn.connect('clicked', (btn) => {
                this._toggleHiddenIconsPopup();
                return Clutter.EVENT_STOP;
            });
            this._box.add_child(this._hiddenIconsBtn);

            // AppIndicator icons container (before system icons)
            // Make it reactive to prevent clicks from propagating to the SystemTray button
            this._appIndicatorContainer = new St.BoxLayout({
                style_class: 'winbar-appindicator-icons',
                reactive: true,
            });
            // Stop clicks on app indicator area from triggering quick settings
            this._appIndicatorContainer.connect('button-press-event', () => {
                return Clutter.EVENT_STOP;
            });
            this._box.add_child(this._appIndicatorContainer);

            // Tray icons container (system icons: network, volume, battery)
            this._trayContainer = new St.BoxLayout({
                style_class: 'winbar-tray-icons',
            });
            this._box.add_child(this._trayContainer);

            this._populateTray();

            // Defer tray content initialization until widget receives its first
            // allocation, so that reparented/cloned children don't trigger
            // "needs an allocation" warnings from the compositor.
            this._initAllocId = this.connect('notify::allocation', () => {
                this.disconnect(this._initAllocId);
                this._initAllocId = 0;
                if (this._isDestroyed) return;

                if (this._isPrimary) {
                    this._initTrayReparenting();
                } else {
                    this._initTrayMirroring();
                }
            });

            // Create hidden icons popup for overflow AppIndicator items
            this._createHiddenIconsPopup();

            // Create quick settings popup
            this._quickSettingsMenu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
            this._quickSettingsMenu.actor.add_style_class_name('winbar-qs-popup-container');
            Main.uiGroup.add_child(this._quickSettingsMenu.actor);
            this._quickSettingsMenu.actor.hide();

            // Close menu when clicking outside
            this._qsCapturedEventId = null;
            this._quickSettingsMenu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    this._updateToggleStates();

                    // Note: Don't use pushModal here - PopupMenu has its own grab mechanism
                    // and pushModal conflicts with it. Use captured-event for click-outside detection.
                    this._qsCapturedEventId = global.stage.connect('captured-event', (actor, event) => {
                        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                            const [eventX, eventY] = event.get_coords();
                            const menuActor = this._quickSettingsMenu.actor;
                            const [menuX, menuY] = menuActor.get_transformed_position();
                            const [menuWidth, menuHeight] = menuActor.get_size();

                            if (eventX < menuX || eventX > menuX + menuWidth ||
                                eventY < menuY || eventY > menuY + menuHeight) {
                                this._quickSettingsMenu.close();
                                return Clutter.EVENT_STOP;
                            }
                        }
                        return Clutter.EVENT_PROPAGATE;
                    });
                } else {
                    if (this._qsCapturedEventId) {
                        global.stage.disconnect(this._qsCapturedEventId);
                        this._qsCapturedEventId = null;
                    }
                }
            });

            // Watch for focus changes - close menu when another window gets focus
            this._qsFocusWindowId = global.display.connect('notify::focus-window', () => {
                const focusWindow = global.display.get_focus_window();
                if (focusWindow && this._quickSettingsMenu && this._quickSettingsMenu.isOpen) {
                    this._quickSettingsMenu.close();
                }
            });

            // Build Quick Settings UI
            this._buildQuickSettingsUI();

            this.connect('clicked', () => {
                // Check if user prefers native GNOME Quick Settings
                const settings = this._extension.getSettings();
                if (settings.get_boolean('use-native-quick-settings')) {
                    // Open GNOME's native Quick Settings panel
                    const gnomeQS = Main.panel.statusArea.quickSettings;
                    if (gnomeQS && gnomeQS.menu) {
                        if (!gnomeQS.menu.isOpen) {
                            // Get Winbar's system tray position BEFORE opening menu
                            const [trayX, trayY] = this.get_transformed_position();
                            const [trayWidth, trayHeight] = this.get_size();
                            const monitor = this._winbar._monitor || Main.layoutManager.primaryMonitor;

                            // Configure the menu to open from the bottom (like Dash to Panel does)
                            // This makes the menu expand upward instead of downward
                            gnomeQS.menu._arrowSide = St.Side.BOTTOM;
                            gnomeQS.menu._arrowAlignment = 0.5;

                            // Also set BoxPointer properties for proper positioning
                            if (gnomeQS.menu._boxPointer) {
                                gnomeQS.menu._boxPointer._userArrowSide = St.Side.BOTTOM;
                                // Store original source actor
                                if (!this._gnomeQsOriginalSourceActor) {
                                    this._gnomeQsOriginalSourceActor = gnomeQS.menu._boxPointer.sourceActor;
                                }
                                // Use this button as the source actor for positioning
                                gnomeQS.menu._boxPointer.sourceActor = this;
                                // Mark that we've adjusted this (like Dash to Panel does)
                                gnomeQS.menu._boxPointer._winbarInPanel = true;

                                // Force the arrow side update - BoxPointer uses _arrowSide internally
                                gnomeQS.menu._boxPointer._arrowSide = St.Side.BOTTOM;
                            }

                            gnomeQS.menu.open();

                            // Function to reposition the menu using bottom-anchored positioning
                            const repositionMenu = () => {
                                const menuActor = gnomeQS.menu.actor;
                                if (!menuActor) return false;

                                // Try to get actual size, fall back to preferred size
                                let [menuWidth, menuHeight] = menuActor.get_size();

                                // If size is 0, try preferred size
                                if (menuWidth === 0 || menuHeight === 0) {
                                    [, , menuWidth, menuHeight] = menuActor.get_preferred_size();
                                }

                                // Still no size? Try the box inside
                                if (menuWidth === 0 || menuHeight === 0) {
                                    const box = menuActor.get_first_child();
                                    if (box) {
                                        [menuWidth, menuHeight] = box.get_size();
                                        if (menuWidth === 0 || menuHeight === 0) {
                                            [, , menuWidth, menuHeight] = box.get_preferred_size();
                                        }
                                    }
                                }

                                // If still no valid size, return false to retry
                                if (menuWidth === 0 || menuHeight === 0) {
                                    return false;
                                }

                                // Position: bottom edge fixed above tray, right-aligned
                                let x = trayX + trayWidth - menuWidth;
                                // Bottom edge anchored at trayY - MENU_OFFSET_PX
                                let y = trayY - menuHeight - MENU_OFFSET_PX;



                                // Keep within THIS monitor's horizontal bounds
                                if (x < monitor.x + MENU_SCREEN_PADDING_PX)
                                    x = monitor.x + MENU_SCREEN_PADDING_PX;
                                if (x + menuWidth > monitor.x + monitor.width - MENU_SCREEN_PADDING_PX)
                                    x = monitor.x + monitor.width - menuWidth - MENU_SCREEN_PADDING_PX;

                                // If menu is too tall, anchor to top of monitor instead
                                if (y < monitor.y + MENU_SCREEN_PADDING_PX)
                                    y = monitor.y + MENU_SCREEN_PADDING_PX;

                                menuActor.set_position(Math.floor(x), Math.floor(y));
                                return true;
                            };

                            // Try repositioning with increasing delays until we get a valid size
                            const tryReposition = (delay, maxAttempts, attempt = 1) => {
                                GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                                    if (!gnomeQS.menu.isOpen) return GLib.SOURCE_REMOVE;

                                    const success = repositionMenu();
                                    if (!success && attempt < maxAttempts) {
                                        // Retry with longer delay
                                        tryReposition(delay * 2, maxAttempts, attempt + 1);
                                    }
                                    return GLib.SOURCE_REMOVE;
                                });
                            };

                            // Start trying at 50ms, up to 5 attempts (50, 100, 200, 400, 800ms)
                            tryReposition(50, 5);

                            // Watch for size changes to reposition when sub-menus expand
                            // Try multiple actors - the one that changes size might be different
                            const boxPointer = gnomeQS.menu._boxPointer;

                            // Disconnect old handlers
                            if (this._gnomeQsAllocationId) {
                                try { gnomeQS.menu.actor.disconnect(this._gnomeQsAllocationId); } catch (e) { /* Signal may already be disconnected */ }
                                this._gnomeQsAllocationId = null;
                            }
                            if (this._gnomeQsHeightId) {
                                try { boxPointer.disconnect(this._gnomeQsHeightId); } catch (e) { /* Signal may already be disconnected */ }
                                this._gnomeQsHeightId = null;
                            }
                            if (this._gnomeQsBinHeightId) {
                                try { boxPointer.bin.disconnect(this._gnomeQsBinHeightId); } catch (e) { /* Signal may already be disconnected */ }
                                this._gnomeQsBinHeightId = null;
                            }

                            // Monitor menu actor allocation changes
                            this._gnomeQsAllocationId = gnomeQS.menu.actor.connect('notify::height', () => {
                                if (gnomeQS.menu.isOpen) repositionMenu();
                            });

                            // Also monitor the BoxPointer height changes
                            this._gnomeQsHeightId = boxPointer.connect('notify::height', () => {
                                if (gnomeQS.menu.isOpen) repositionMenu();
                            });

                            // And the bin inside the BoxPointer
                            if (boxPointer.bin) {
                                this._gnomeQsBinHeightId = boxPointer.bin.connect('notify::height', () => {
                                    if (gnomeQS.menu.isOpen) repositionMenu();
                                });
                            }

                            // Clean up handler when menu closes
                            const closeId = gnomeQS.menu.connect('open-state-changed', (menu, isOpen) => {
                                if (!isOpen) {
                                    // Disconnect all height monitors
                                    if (this._gnomeQsAllocationId) {
                                        try { gnomeQS.menu.actor.disconnect(this._gnomeQsAllocationId); } catch (e) { /* Signal may already be disconnected */ }
                                        this._gnomeQsAllocationId = null;
                                    }
                                    if (this._gnomeQsHeightId) {
                                        try { boxPointer.disconnect(this._gnomeQsHeightId); } catch (e) { /* Signal may already be disconnected */ }
                                        this._gnomeQsHeightId = null;
                                    }
                                    if (this._gnomeQsBinHeightId && boxPointer.bin) {
                                        try { boxPointer.bin.disconnect(this._gnomeQsBinHeightId); } catch (e) { /* Signal may already be disconnected */ }
                                        this._gnomeQsBinHeightId = null;
                                    }
                                    // Restore original BoxPointer settings
                                    if (gnomeQS.menu._boxPointer) {
                                        if (this._gnomeQsOriginalSourceActor) {
                                            gnomeQS.menu._boxPointer.sourceActor = this._gnomeQsOriginalSourceActor;
                                        }
                                        gnomeQS.menu._boxPointer._userArrowSide = St.Side.TOP;
                                        gnomeQS.menu._boxPointer._arrowSide = St.Side.TOP;
                                        gnomeQS.menu._boxPointer._winbarInPanel = false;
                                    }
                                    gnomeQS.menu._arrowSide = St.Side.TOP;
                                    gnomeQS.menu.disconnect(closeId);
                                }
                            });

                        } else {
                            gnomeQS.menu.close();
                        }
                    }
                } else {
                    this._quickSettingsMenu.toggle();
                }
            });
        }

        _buildQuickSettingsUI() {
            const qsItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                style_class: 'winbar-qs-menu-item',
            });

            this._qsBox = new St.BoxLayout({
                vertical: true,
                style_class: 'winbar-quick-settings-popup',
            });

            // Add blur effect for modern frosted glass look
            addBlurEffect(this._qsBox);

            // === Row 1: WiFi, Bluetooth, Airplane Mode ===
            const row1 = new St.BoxLayout({
                style_class: 'winbar-qs-row',
                x_expand: true,
            });

            // WiFi toggle with dropdown
            this._wifiToggle = this._createToggleTile(
                'network-wireless-symbolic',
                _('Wi-Fi'),
                'wifi',
                () => this._toggleWifi(),
                () => this._openWifiSettings()
            );
            row1.add_child(this._wifiToggle);

            // Bluetooth toggle with dropdown
            this._bluetoothToggle = this._createToggleTile(
                'bluetooth-active-symbolic',
                _('Bluetooth'),
                'bluetooth',
                () => this._toggleBluetooth(),
                () => this._openBluetoothSettings()
            );
            row1.add_child(this._bluetoothToggle);

            // Airplane mode toggle
            this._airplaneToggle = this._createToggleTile(
                'airplane-mode-symbolic',
                _('Airplane Mode'),
                'airplane',
                () => this._toggleAirplaneMode(),
                null
            );
            row1.add_child(this._airplaneToggle);

            this._qsBox.add_child(row1);

            // === Row 2: Night Light, Do Not Disturb, etc ===
            const row2 = new St.BoxLayout({
                style_class: 'winbar-qs-row',
                x_expand: true,
            });

            // Night Light toggle
            this._nightLightToggle = this._createToggleTile(
                'night-light-symbolic',
                _('Night Light'),
                'nightlight',
                () => this._toggleNightLight(),
                null
            );
            row2.add_child(this._nightLightToggle);

            // Do Not Disturb toggle
            this._dndToggle = this._createToggleTile(
                'notifications-disabled-symbolic',
                _('Do Not Disturb'),
                'dnd',
                () => this._toggleDND(),
                null
            );
            row2.add_child(this._dndToggle);

            // Dark Mode toggle
            this._darkModeToggle = this._createToggleTile(
                'weather-clear-night-symbolic',
                _('Dark Mode'),
                'darkmode',
                () => this._toggleDarkMode(),
                null
            );
            row2.add_child(this._darkModeToggle);

            this._qsBox.add_child(row2);

            // === Output Device Section ===
            this._outputDeviceSection = new St.BoxLayout({
                style_class: 'winbar-qs-output-section',
                vertical: true,
                x_expand: true,
            });

            // Header row with label and expand button
            this._outputDeviceHeader = new St.BoxLayout({
                style_class: 'winbar-qs-output-header',
                x_expand: true,
            });

            this._outputDeviceLabel = new St.Label({
                text: _('Output Device'),
                style_class: 'winbar-qs-output-title',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._outputDeviceHeader.add_child(this._outputDeviceLabel);

            // Current device name
            this._currentOutputLabel = new St.Label({
                text: '',
                style_class: 'winbar-qs-output-current',
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._outputDeviceHeader.add_child(this._currentOutputLabel);

            // Expand/collapse button
            this._outputExpandBtn = new St.Button({
                style_class: 'winbar-qs-output-expand-btn',
                child: new St.Icon({
                    icon_name: 'pan-down-symbolic',
                    icon_size: 14,
                }),
                reactive: true,
                can_focus: true,
            });
            this._outputExpandBtn.connect('clicked', () => {
                this._toggleOutputDeviceList();
            });
            this._outputDeviceHeader.add_child(this._outputExpandBtn);

            this._outputDeviceSection.add_child(this._outputDeviceHeader);

            // Output device list (hidden by default)
            this._outputDeviceList = new St.BoxLayout({
                style_class: 'winbar-qs-output-list',
                vertical: true,
                visible: false,
                x_expand: true,
            });
            this._outputDeviceSection.add_child(this._outputDeviceList);

            this._qsBox.add_child(this._outputDeviceSection);

            // === Volume Slider ===
            this._volumeBox = new St.BoxLayout({
                style_class: 'winbar-qs-slider-box',
                x_expand: true,
            });

            // Volume icon button (click to mute/unmute)
            this._volumeBtn = new St.Button({
                style_class: 'winbar-qs-volume-btn',
                child: new St.Icon({
                    icon_name: 'audio-volume-medium-symbolic',
                    icon_size: 18,
                }),
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            this._volumeBtn.connect('clicked', () => {
                this._toggleMute();
            });
            this._volumeBox.add_child(this._volumeBtn);

            this._volumeSlider = new Slider.Slider(0.5);
            this._volumeSlider.style_class = 'winbar-qs-slider';
            this._volumeSlider.x_expand = true;
            this._volumeChangedId = this._volumeSlider.connect('notify::value', () => {
                this._setVolume(this._volumeSlider.value);
            });
            this._volumeBox.add_child(this._volumeSlider);

            this._qsBox.add_child(this._volumeBox);

            // === Brightness Slider (only if backlight is available) ===
            this._brightnessBox = new St.BoxLayout({
                style_class: 'winbar-qs-slider-box',
                x_expand: true,
                visible: false, // Hidden by default, shown if backlight available
            });

            this._brightnessIcon = new St.Icon({
                icon_name: 'display-brightness-symbolic',
                icon_size: 18,
                style_class: 'winbar-qs-slider-icon',
            });
            this._brightnessBox.add_child(this._brightnessIcon);

            this._brightnessSlider = new Slider.Slider(0.7);
            this._brightnessSlider.style_class = 'winbar-qs-slider';
            this._brightnessSlider.x_expand = true;
            this._brightnessSlider.connect('notify::value', () => {
                this._setBrightness(this._brightnessSlider.value);
            });
            this._brightnessBox.add_child(this._brightnessSlider);

            this._qsBox.add_child(this._brightnessBox);

            // === Bottom row with battery (only shown if battery available) ===
            this._bottomRow = new St.BoxLayout({
                style_class: 'winbar-qs-bottom-row',
                x_expand: true,
                visible: false, // Hidden by default, shown if battery available
            });

            // Battery indicator
            this._batteryIcon = new St.Icon({
                icon_name: 'battery-good-symbolic',
                icon_size: 16,
            });
            this._bottomRow.add_child(this._batteryIcon);

            this._batteryLabel = new St.Label({
                text: '100%',
                style_class: 'winbar-qs-battery-label',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._bottomRow.add_child(this._batteryLabel);

            this._qsBox.add_child(this._bottomRow);

            qsItem.add_child(this._qsBox);
            this._quickSettingsMenu.addMenuItem(qsItem);

            // Initialize states
            this._initializeStates();
        }

        _createToggleTile(iconName, label, id, toggleCallback, settingsCallback) {
            const tile = new St.BoxLayout({
                style_class: 'winbar-qs-tile',
                vertical: false,
                x_expand: true,
                reactive: true,
            });

            // Main toggle button
            const mainBtn = new St.Button({
                style_class: 'winbar-qs-tile-main',
                x_expand: true,
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            const mainContent = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            // Icon
            const icon = new St.Icon({
                icon_name: iconName,
                icon_size: 24,
                style_class: 'winbar-qs-tile-icon',
            });
            mainContent.add_child(icon);

            const labelWidget = new St.Label({
                text: label,
                style_class: 'winbar-qs-tile-label',
                x_align: Clutter.ActorAlign.CENTER,
            });
            mainContent.add_child(labelWidget);

            mainBtn.set_child(mainContent);
            mainBtn.connect('clicked', () => {
                if (toggleCallback) toggleCallback();
            });

            tile.add_child(mainBtn);

            // Settings/arrow button (if provided)
            if (settingsCallback) {
                mainBtn.add_style_class_name('has-arrow');
                const arrowBtn = new St.Button({
                    style_class: 'winbar-qs-tile-arrow',
                    child: new St.Icon({
                        icon_name: 'go-next-symbolic',
                        icon_size: 14,
                    }),
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                });
                arrowBtn.connect('clicked', () => {
                    this._quickSettingsMenu.close();
                    if (settingsCallback) settingsCallback();
                });
                tile.add_child(arrowBtn);
            }

            // Store references for state updates
            tile._icon = icon;
            tile._label = labelWidget;
            tile._mainBtn = mainBtn;
            tile._id = id;

            return tile;
        }

        _initializeStates() {
            // Check hardware availability and set initial states
            this._checkWifiAvailability();
            this._checkBluetoothAvailability();
            this._checkBacklightAvailability();
            this._checkBatteryAvailability();

            // Initialize volume state
            this._initializeVolume();

            // Initialize toggle states
            this._updateToggleStates();
        }

        _initializeVolume() {
            this._soundAvailable = false;
            this._isMuted = false;
            this._currentVolume = 0.5;
            this._outputDeviceListExpanded = false;

            // Use GNOME's built-in volume control
            this._mixerControl = new Gvc.MixerControl({ name: 'Winbar Volume Control' });

            this._mixerStateChangedId = this._mixerControl.connect('state-changed', () => {
                if (this._mixerControl.get_state() === Gvc.MixerControlState.READY) {
                    this._onMixerReady();
                }
            });

            this._mixerDefaultSinkChangedId = this._mixerControl.connect('default-sink-changed', () => {
                this._updateVolumeFromMixer();
                this._updateCurrentOutputLabel();
                this._refreshOutputDeviceList();
            });

            // Listen for sink additions/removals
            this._mixerStreamAddedId = this._mixerControl.connect('stream-added', () => {
                if (this._outputDeviceListExpanded) {
                    this._refreshOutputDeviceList();
                }
            });

            this._mixerStreamRemovedId = this._mixerControl.connect('stream-removed', () => {
                if (this._outputDeviceListExpanded) {
                    this._refreshOutputDeviceList();
                }
            });

            this._mixerControl.open();
        }

        _onMixerReady() {
            this._soundAvailable = true;
            const sink = this._mixerControl.get_default_sink();
            if (sink) {
                this._streamChangedId = sink.connect('notify::volume', () => {
                    this._updateVolumeFromMixer();
                });
                this._streamMuteId = sink.connect('notify::is-muted', () => {
                    this._updateVolumeFromMixer();
                });
                this._updateVolumeFromMixer();
                this._updateCurrentOutputLabel();
            }
        }

        _updateVolumeFromMixer() {
            const sink = this._mixerControl.get_default_sink();
            if (!sink) return;

            const maxVol = this._mixerControl.get_vol_max_norm();
            const volume = sink.get_volume() / maxVol;
            this._currentVolume = Math.min(volume, 1.0);
            this._isMuted = sink.get_is_muted();

            // Update slider without triggering the callback
            if (this._volumeSlider && this._volumeChangedId) {
                this._volumeSlider.block_signal_handler(this._volumeChangedId);
                this._volumeSlider.value = this._currentVolume;
                this._volumeSlider.unblock_signal_handler(this._volumeChangedId);
            }
            this._updateVolumeIcon(this._currentVolume);
        }

        _disableVolumeControls() {
            // Disable volume button and slider when no sound card
            if (this._volumeBtn) {
                this._volumeBtn.reactive = false;
                this._volumeBtn.add_style_class_name('disabled');
            }
            if (this._volumeSlider) {
                this._volumeSlider.reactive = false;
                this._volumeSlider.add_style_class_name('disabled');
            }
            // Show disabled icon
            this._updateVolumeIcon(0);
        }

        _toggleMute() {
            if (!this._soundAvailable) return;

            const sink = this._mixerControl?.get_default_sink();
            if (sink) {
                sink.set_is_muted(!sink.get_is_muted());
            }
        }

        _updateVolumeIcon(volume) {
            let iconName;
            if (!this._soundAvailable) {
                iconName = 'audio-volume-muted-symbolic';
            } else if (this._isMuted || volume === 0) {
                iconName = 'audio-volume-muted-symbolic';
            } else if (volume < 0.33) {
                iconName = 'audio-volume-low-symbolic';
            } else if (volume < 0.66) {
                iconName = 'audio-volume-medium-symbolic';
            } else {
                iconName = 'audio-volume-high-symbolic';
            }

            // Update popup volume button icon
            if (this._volumeBtn) {
                const icon = this._volumeBtn.get_child();
                if (icon) {
                    icon.icon_name = iconName;
                }
            }
            // Update tray icon
            if (this._trayVolumeIcon) {
                this._trayVolumeIcon.icon_name = iconName;
            }
        }

        _updateCurrentOutputLabel() {
            if (this._isDestroyed || !this._currentOutputLabel) return;

            const sink = this._mixerControl?.get_default_sink();
            if (sink) {
                // Get a friendly name for the device
                let name = sink.get_description() || sink.get_name() || _('Unknown Device');
                // Truncate if too long
                if (name.length > 35) {
                    name = name.substring(0, 32) + '...';
                }
                this._currentOutputLabel.text = name;
            } else {
                this._currentOutputLabel.text = _('No output device');
            }
        }

        _toggleOutputDeviceList() {
            if (this._isDestroyed) return;

            this._outputDeviceListExpanded = !this._outputDeviceListExpanded;

            if (this._outputDeviceList) {
                this._outputDeviceList.visible = this._outputDeviceListExpanded;
            }

            if (this._outputExpandIcon) {
                this._outputExpandIcon.icon_name = this._outputDeviceListExpanded
                    ? 'pan-up-symbolic'
                    : 'pan-down-symbolic';
            }

            if (this._outputDeviceListExpanded) {
                this._refreshOutputDeviceList();
            }
        }

        _refreshOutputDeviceList() {
            if (this._isDestroyed || !this._outputDeviceList) return;

            // Clear existing items
            this._outputDeviceList.destroy_all_children();

            if (!this._mixerControl) return;

            const sinks = this._mixerControl.get_sinks();
            const defaultSink = this._mixerControl.get_default_sink();
            const defaultSinkId = defaultSink ? defaultSink.get_id() : null;

            if (!sinks || sinks.length === 0) {
                const noDevicesLabel = new St.Label({
                    text: _('No output devices available'),
                    style_class: 'quick-settings-output-no-devices',
                    style: 'color: #888888; padding: 8px 12px; font-size: 11px;'
                });
                this._outputDeviceList.add_child(noDevicesLabel);
                return;
            }

            sinks.forEach(sink => {
                const isActive = sink.get_id() === defaultSinkId;
                const name = sink.get_description() || sink.get_name() || _('Unknown');

                const deviceBtn = new St.Button({
                    style_class: 'quick-settings-output-device-btn',
                    style: `
                        padding: 6px 12px;
                        border-radius: 6px;
                        background-color: ${isActive ? 'rgba(100, 150, 255, 0.3)' : 'transparent'};
                        margin: 2px 0;
                    `,
                    x_expand: true
                });

                const deviceBox = new St.BoxLayout({
                    vertical: false,
                    x_expand: true
                });

                // Check icon for active device
                const checkIcon = new St.Icon({
                    icon_name: isActive ? 'emblem-ok-symbolic' : '',
                    icon_size: 14,
                    style: 'margin-right: 8px; min-width: 14px;'
                });

                const deviceLabel = new St.Label({
                    text: name,
                    style: `
                        font-size: 11px; 
                        color: ${isActive ? '#ffffff' : '#cccccc'};
                        font-weight: ${isActive ? 'bold' : 'normal'};
                    `,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER
                });

                deviceBox.add_child(checkIcon);
                deviceBox.add_child(deviceLabel);
                deviceBtn.set_child(deviceBox);

                deviceBtn.connect('clicked', () => {
                    if (this._isDestroyed) return;
                    this._setDefaultSink(sink);
                });

                // Hover effects
                deviceBtn.connect('enter-event', () => {
                    if (!isActive) {
                        deviceBtn.style = `
                            padding: 6px 12px;
                            border-radius: 6px;
                            background-color: rgba(255, 255, 255, 0.1);
                            margin: 2px 0;
                        `;
                    }
                });

                deviceBtn.connect('leave-event', () => {
                    deviceBtn.style = `
                        padding: 6px 12px;
                        border-radius: 6px;
                        background-color: ${isActive ? 'rgba(100, 150, 255, 0.3)' : 'transparent'};
                        margin: 2px 0;
                    `;
                });

                this._outputDeviceList.add_child(deviceBtn);
            });
        }

        _setDefaultSink(sink) {
            if (this._isDestroyed || !sink) return;

            try {
                this._mixerControl.set_default_sink(sink);
                // Update the label immediately
                this._updateCurrentOutputLabel();
                // Refresh the list to update active state
                this._refreshOutputDeviceList();
            } catch (e) {
                log(`[Winbar] Error setting default sink: ${e}`);
            }
        }

        _checkWifiAvailability() {
            this._wifiAvailable = false;
            // Check for actual WiFi devices using nmcli
            try {
                const proc = Gio.Subprocess.new(
                    ['nmcli', '-t', '-f', 'TYPE,DEVICE', 'device'],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
                proc.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        const [, stdout] = proc.communicate_utf8_finish(res);
                        // Check if any wifi device exists
                        this._wifiAvailable = stdout.includes('wifi:');
                        this._setToggleAvailable(this._wifiToggle, this._wifiAvailable);

                        // Also update network icon based on connection type
                        this._updateNetworkIcon(stdout);
                    } catch (e) {
                        this._setToggleAvailable(this._wifiToggle, false);
                        this._updateNetworkIcon('');
                    }
                });
            } catch (e) {
                this._setToggleAvailable(this._wifiToggle, false);
            }
        }

        _updateNetworkIcon(nmcliOutput) {
            // Determine the best network icon based on available connections
            let iconName = 'network-offline-symbolic';

            try {
                // Check active connections
                const proc = Gio.Subprocess.new(
                    ['nmcli', '-t', '-f', 'TYPE,STATE', 'connection', 'show', '--active'],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
                proc.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        const [, stdout] = proc.communicate_utf8_finish(res);

                        if (stdout.includes('wireless:') || stdout.includes('wifi:')) {
                            iconName = 'network-wireless-symbolic';
                        } else if (stdout.includes('ethernet:') || stdout.includes('802-3-ethernet:')) {
                            iconName = 'network-wired-symbolic';
                        } else if (stdout.includes('vpn:')) {
                            iconName = 'network-vpn-symbolic';
                        } else if (stdout.trim().length > 0) {
                            // Some connection is active
                            iconName = 'network-wired-symbolic';
                        }

                        if (this._networkIcon) {
                            this._networkIcon.icon_name = iconName;
                        }
                    } catch (e) {
                        if (this._networkIcon) {
                            this._networkIcon.icon_name = 'network-offline-symbolic';
                        }
                    }
                });
            } catch (e) {
                if (this._networkIcon) {
                    this._networkIcon.icon_name = 'network-offline-symbolic';
                }
            }
        }

        _checkBluetoothAvailability() {
            this._bluetoothAvailable = false;
            try {
                const proc = Gio.Subprocess.new(
                    ['rfkill', 'list', 'bluetooth'],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
                proc.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        const [, stdout] = proc.communicate_utf8_finish(res);
                        // If we get output, bluetooth hardware exists
                        this._bluetoothAvailable = stdout.trim().length > 0;
                        this._setToggleAvailable(this._bluetoothToggle, this._bluetoothAvailable);
                    } catch (e) {
                        this._setToggleAvailable(this._bluetoothToggle, false);
                    }
                });
            } catch (e) {
                this._setToggleAvailable(this._bluetoothToggle, false);
            }
        }

        _checkBacklightAvailability() {
            // Try to check backlight via D-Bus
            try {
                const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(`
                <node>
                    <interface name="org.gnome.SettingsDaemon.Power.Screen">
                        <property name="Brightness" type="i" access="readwrite"/>
                    </interface>
                </node>
            `);

                this._brightnessProxy = new BrightnessProxy(
                    Gio.DBus.session,
                    'org.gnome.SettingsDaemon.Power',
                    '/org/gnome/SettingsDaemon/Power',
                    (proxy, error) => {
                        if (error) {
                            // Backlight not available
                            this._brightnessBox.visible = false;
                            return;
                        }
                        try {
                            const brightness = proxy.Brightness;
                            if (brightness >= 0) {
                                this._brightnessBox.visible = true;
                                this._brightnessSlider.value = brightness / 100;
                            }
                        } catch (e) {
                            this._brightnessBox.visible = false;
                        }
                    }
                );
            } catch (e) {
                this._brightnessBox.visible = false;
            }
        }

        _checkBatteryAvailability() {
            // Hide tray battery icon by default
            if (this._trayBatteryIcon) {
                this._trayBatteryIcon.visible = false;
            }

            try {
                const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(`
                <node>
                    <interface name="org.freedesktop.UPower.Device">
                        <property name="Percentage" type="d" access="read"/>
                        <property name="State" type="u" access="read"/>
                        <property name="Type" type="u" access="read"/>
                    </interface>
                </node>
            `);

                this._batteryProxy = new UPowerProxy(
                    Gio.DBus.system,
                    'org.freedesktop.UPower',
                    'org/freedesktop/UPower/devices/DisplayDevice',
                    (proxy, error) => {
                        if (error) {
                            this._bottomRow.visible = false;
                            if (this._trayBatteryIcon) this._trayBatteryIcon.visible = false;
                            return;
                        }
                        try {
                            // Type 2 = Battery
                            const deviceType = proxy.Type;
                            if (deviceType === 2) {
                                this._bottomRow.visible = true;
                                if (this._trayBatteryIcon) this._trayBatteryIcon.visible = true;
                                this._updateBatteryFromProxy(proxy);
                            } else {
                                this._bottomRow.visible = false;
                                if (this._trayBatteryIcon) this._trayBatteryIcon.visible = false;
                            }
                        } catch (e) {
                            this._bottomRow.visible = false;
                            if (this._trayBatteryIcon) this._trayBatteryIcon.visible = false;
                        }
                    }
                );
            } catch (e) {
                this._bottomRow.visible = false;
                if (this._trayBatteryIcon) this._trayBatteryIcon.visible = false;
            }
        }

        _updateBatteryFromProxy(proxy) {
            try {
                const percentage = proxy.Percentage;
                const state = proxy.State;
                this._batteryLabel.text = `${Math.round(percentage)}%`;

                // Update icon based on percentage
                let iconName = 'battery-full-symbolic';
                if (percentage <= 10) iconName = 'battery-empty-symbolic';
                else if (percentage <= 30) iconName = 'battery-low-symbolic';
                else if (percentage <= 60) iconName = 'battery-good-symbolic';

                // State 1 = Charging
                if (state === 1) iconName = iconName.replace('-symbolic', '-charging-symbolic');
                this._batteryIcon.icon_name = iconName;

                // Also update tray icon
                if (this._trayBatteryIcon) {
                    this._trayBatteryIcon.icon_name = iconName;
                }
            } catch (e) {
                // Ignore errors
            }
        }

        _setToggleAvailable(toggle, available) {
            if (!toggle) return;

            toggle._available = available;
            if (available) {
                toggle.remove_style_class_name('unavailable');
                toggle._mainBtn.reactive = true;
            } else {
                toggle.add_style_class_name('unavailable');
                toggle._mainBtn.reactive = false;
                toggle._mainBtn.remove_style_class_name('active');
            }
        }

        _updateToggleStates() {
            // Update WiFi state - only if WiFi hardware is available
            if (this._wifiAvailable) {
                try {
                    const proc = Gio.Subprocess.new(
                        ['nmcli', 'radio', 'wifi'],
                        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                    );
                    proc.communicate_utf8_async(null, null, (proc, res) => {
                        try {
                            const [, stdout] = proc.communicate_utf8_finish(res);
                            const wifiEnabled = stdout.trim() === 'enabled';
                            this._setToggleActive(this._wifiToggle, wifiEnabled);
                        } catch (e) {
                            this._setToggleActive(this._wifiToggle, false);
                        }
                    });
                } catch (e) {
                    // NetworkManager not available
                }
            } else {
                // No WiFi hardware - ensure toggle is not active
                this._setToggleActive(this._wifiToggle, false);
            }

            // Update Bluetooth state - only if Bluetooth hardware is available
            if (this._bluetoothAvailable) {
                try {
                    const proc = Gio.Subprocess.new(
                        ['rfkill', 'list', 'bluetooth'],
                        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                    );
                    proc.communicate_utf8_async(null, null, (proc, res) => {
                        try {
                            const [, stdout] = proc.communicate_utf8_finish(res);
                            // Check if bluetooth is not soft-blocked
                            const isBlocked = stdout.includes('Soft blocked: yes');
                            this._setToggleActive(this._bluetoothToggle, !isBlocked);
                        } catch (e) {
                            this._setToggleActive(this._bluetoothToggle, false);
                        }
                    });
                } catch (e) {
                    // rfkill not available
                }
            } else {
                // No Bluetooth hardware - ensure toggle is not active
                this._setToggleActive(this._bluetoothToggle, false);
            }

            // Update Night Light state
            try {
                const settings = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.plugins.color' });
                const nightLightEnabled = settings.get_boolean('night-light-enabled');
                this._setToggleActive(this._nightLightToggle, nightLightEnabled);
            } catch (e) {
                // Night light settings not available
            }

            // Update Dark Mode state
            try {
                const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                const colorScheme = settings.get_string('color-scheme');
                this._setToggleActive(this._darkModeToggle, colorScheme === 'prefer-dark');
            } catch (e) {
                // Settings not available
            }

            // Update DND state
            try {
                const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });
                const dndEnabled = !settings.get_boolean('show-banners');
                this._setToggleActive(this._dndToggle, dndEnabled);
            } catch (e) {
                // Settings not available
            }
        }

        _setToggleActive(toggle, active) {
            if (active) {
                toggle._mainBtn.add_style_class_name('active');
            } else {
                toggle._mainBtn.remove_style_class_name('active');
            }
            toggle._active = active;
        }

        _toggleWifi() {
            try {
                const client = imports.gi.NM?.Client?.new(null);
                if (client) {
                    client.wireless_enabled = !client.wireless_enabled;
                    this._setToggleActive(this._wifiToggle, client.wireless_enabled);
                }
            } catch (e) {
                // Try via settings
                try {
                    Gio.Subprocess.new(['nmcli', 'radio', 'wifi',
                        this._wifiToggle._active ? 'off' : 'on'], Gio.SubprocessFlags.NONE);
                    this._setToggleActive(this._wifiToggle, !this._wifiToggle._active);
                } catch (e2) { /* Ignore: nmcli may not be available */ }
            }
        }

        _openWifiSettings() {
            try {
                Gio.Subprocess.new(['gnome-control-center', 'wifi'], Gio.SubprocessFlags.NONE);
            } catch (e) { /* Ignore: gnome-control-center may not be installed */ }
        }

        _toggleBluetooth() {
            try {
                const settings = new Gio.Settings({ schema_id: 'org.blueman.plugins.powermanager' });
                const enabled = settings.get_boolean('auto-power-on');
                settings.set_boolean('auto-power-on', !enabled);
                this._setToggleActive(this._bluetoothToggle, !enabled);
            } catch (e) {
                // Try rfkill
                try {
                    const newState = this._bluetoothToggle._active ? 'block' : 'unblock';
                    Gio.Subprocess.new(['rfkill', newState, 'bluetooth'], Gio.SubprocessFlags.NONE);
                    this._setToggleActive(this._bluetoothToggle, !this._bluetoothToggle._active);
                } catch (e2) { /* Ignore: rfkill may not be available */ }
            }
        }

        _openBluetoothSettings() {
            try {
                Gio.Subprocess.new(['gnome-control-center', 'bluetooth'], Gio.SubprocessFlags.NONE);
            } catch (e) { /* Ignore: gnome-control-center may not be installed */ }
        }

        _toggleAirplaneMode() {
            try {
                const newState = this._airplaneToggle._active ? 'unblock' : 'block';
                Gio.Subprocess.new(['rfkill', newState, 'all'], Gio.SubprocessFlags.NONE);
                this._setToggleActive(this._airplaneToggle, !this._airplaneToggle._active);
            } catch (e) { /* Ignore: rfkill may not be available */ }
        }

        _toggleNightLight() {
            try {
                const settings = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.plugins.color' });
                const enabled = settings.get_boolean('night-light-enabled');
                settings.set_boolean('night-light-enabled', !enabled);
                this._setToggleActive(this._nightLightToggle, !enabled);
            } catch (e) { /* Ignore: GSettings schema may not be available */ }
        }

        _toggleDND() {
            try {
                const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });
                const showBanners = settings.get_boolean('show-banners');
                // Toggle: if banners are shown, disable them (enable DND)
                settings.set_boolean('show-banners', !showBanners);
                // DND is active when banners are NOT shown
                this._setToggleActive(this._dndToggle, showBanners); // showBanners was true, now false, so DND is ON
            } catch (e) { /* Ignore: notification GSettings schema may not be available */ }
        }

        _toggleDarkMode() {
            try {
                const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                const currentScheme = settings.get_string('color-scheme');
                const newScheme = currentScheme === 'prefer-dark' ? 'prefer-light' : 'prefer-dark';
                settings.set_string('color-scheme', newScheme);
                this._setToggleActive(this._darkModeToggle, newScheme === 'prefer-dark');
            } catch (e) { /* Ignore: GSettings schema may not be available */ }
        }

        _setVolume(value) {
            const sink = this._mixerControl?.get_default_sink();
            if (!sink) return;

            const maxVol = this._mixerControl.get_vol_max_norm();
            sink.set_volume(value * maxVol);
            sink.push_volume();

            // Unmute if volume is being set
            if (value > 0 && sink.get_is_muted()) {
                sink.set_is_muted(false);
            }

            // Update icon
            this._updateVolumeIcon(value);
        }

        _setBrightness(value) {
            try {
                const percentage = Math.round(value * 100);
                // Try various brightness control methods
                Gio.Subprocess.new(['gdbus', 'call', '--session',
                    '--dest', 'org.gnome.SettingsDaemon.Power',
                    '--object-path', '/org/gnome/SettingsDaemon/Power',
                    '--method', 'org.freedesktop.DBus.Properties.Set',
                    'org.gnome.SettingsDaemon.Power.Screen', 'Brightness',
                    `<int32 ${percentage}>`], Gio.SubprocessFlags.NONE);
            } catch (e) {
                try {
                    // Fallback to brightnessctl
                    Gio.Subprocess.new(['brightnessctl', 'set', `${Math.round(value * 100)}%`],
                        Gio.SubprocessFlags.NONE);
                } catch (e2) { /* Ignore: brightnessctl may not be installed */ }
            }
        }

        /**
         * Create a tracked deferred callback that is automatically canceled on destroy.
         */
        _deferCall(fn, priority = GLib.PRIORITY_DEFAULT_IDLE) {
            const sourceId = GLib.idle_add(priority, () => {
                this._pendingIdleSources.delete(sourceId);
                if (!this._isDestroyed) {
                    try {
                        fn();
                    } catch (e) {
                        // Widget may have been disposed from C code
                    }
                }
                return GLib.SOURCE_REMOVE;
            });
            this._pendingIdleSources.add(sourceId);
            return sourceId;
        }

        _populateTray() {
            // Network indicator
            this._networkIcon = new St.Icon({
                icon_name: 'network-wireless-symbolic',
                icon_size: 16,
                style_class: 'winbar-tray-icon-widget',
            });
            this._trayContainer.add_child(this._networkIcon);

            // Volume indicator
            this._trayVolumeIcon = new St.Icon({
                icon_name: 'audio-volume-medium-symbolic',
                icon_size: 16,
                style_class: 'winbar-tray-icon-widget',
            });
            this._trayContainer.add_child(this._trayVolumeIcon);

            // Battery indicator
            this._trayBatteryIcon = new St.Icon({
                icon_name: 'battery-good-symbolic',
                icon_size: 16,
                style_class: 'winbar-tray-icon-widget',
            });
            this._trayContainer.add_child(this._trayBatteryIcon);
        }

        /**
         * Initialize tray reparenting
         * This steals standard tray items from GNOME Shell's panel that aren't native
         * (like AppIndicator support items) and moves them to our panel.
         */
        _initTrayReparenting() {
            // Items we NEVER want to steal because we implement our own or they are core GNOME
            const ignoredItems = [
                'aggregateMenu',
                'dateMenu',
                'appMenu',
                'activities',
                'keyboard',
                'a11y',
                'screenRecording',
                'screenSharing',
                'quickSettings', // Core GNOME Quick Settings (Network/Volume/Battery)
                'dwellClick',    // Accessibility feature
                'ArcMenu'        // Start menu extension, usually we want to control it separately
            ];

            // Function to check and steal items
            const checkAndStealItems = () => {
                if (this._isDestroyed) return;

                // Check standard status area
                for (const k in Main.panel.statusArea) {
                    if (ignoredItems.includes(k)) continue;

                    const item = Main.panel.statusArea[k];
                    if (item && !this._hijackedItems.has(k)) {
                        this._hijackItem(k, item);
                    }
                }

                // Check left box (some extensions put stuff here)
                Main.panel._leftBox.get_children().forEach(child => {
                    this._checkAndHijackGenericActor(child, 'left');
                });

                // Check right box
                Main.panel._rightBox.get_children().forEach(child => {
                    this._checkAndHijackGenericActor(child, 'right');
                });
            };

            // Run immediately (widget is already allocated at this point since
            // _initTrayReparenting is called from the notify::allocation handler)
            checkAndStealItems();

            // Watch for new items added to panel boxes
            this._rightBoxWatcherId = Main.panel._rightBox.connect('child-added', () => {
                this._deferCall(() => checkAndStealItems(), GLib.PRIORITY_LOW);
            });

            this._leftBoxWatcherId = Main.panel._leftBox.connect('child-added', () => {
                this._deferCall(() => checkAndStealItems(), GLib.PRIORITY_LOW);
            });

            // Periodically check for new items (every 2 seconds)
            // This is needed because some extensions load lazily or don't emit child-added on the box immediately
            this._periodicCheckId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, TRAY_PERIODIC_CHECK_INTERVAL_SECONDS, () => {
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;
                checkAndStealItems();
                this._validateHijackedItems();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _validateHijackedItems() {
            if (this._isDestroyed) return;

            const toRemove = [];
            this._hijackedItems.forEach((info, key) => {
                const { actor } = info;

                // Check if actor is still valid
                if (!actor || actor._destroyed) {
                    toRemove.push(key);
                    return;
                }

                // Check if actor is still on stage (AppIndicator may recreate icons)
                try {
                    if (!actor.get_stage()) {
                        toRemove.push(key);
                        return;
                    }
                } catch (e) {
                    toRemove.push(key);
                    return;
                }

                // Check if actor is still in our container
                if (actor.get_parent() !== this._appIndicatorContainer) {
                    toRemove.push(key);
                    return;
                }
            });

            // Remove stale items
            toRemove.forEach(key => {
                const info = this._hijackedItems.get(key);
                if (info && info.actor && !info.actor._destroyed) {
                    if (info.destroyId) {
                        try {
                            info.actor.disconnect(info.destroyId);
                        } catch (e) { /* Signal may already be disconnected */ }
                    }
                    // Only touch the style class if the actor is still on stage,
                    // otherwise the theme_node lookup triggers warnings.
                    try {
                        if (info.actor.get_stage()) {
                            info.actor.remove_style_class_name('winbar-hijacked-tray-item');
                        }
                    } catch (e) { /* Actor may be in limbo */ }
                }

                this._hijackedItems.delete(key);
                trayManager.unregisterItem(key);
            });
        }

        _initTrayMirroring() {
            // Add existing items
            trayManager.getItems().forEach((info, id) => {
                this._addClonedItem(id, info.actor, info.item);
            });

            // Listen for new items
            this._tmAddedId = trayManager.connect('item-added', (tm, id, actor) => {
                const info = tm.getItem(id);
                if (info) {
                    this._addClonedItem(id, actor, info.item);
                }
            });

            // Listen for removed items
            this._tmRemovedId = trayManager.connect('item-removed', (tm, id) => {
                this._removeClonedItem(id);
            });

            // Periodic validation of cloned items - remove stale/invalid ones
            this._cloneValidationId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, TRAY_CLONE_VALIDATION_INTERVAL_SECONDS, () => {
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;
                this._validateClonedItems();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _validateClonedItems() {
            if (this._isDestroyed) return;

            const toRemove = [];
            this._clonedItems.forEach((info, id) => {
                const { sourceActor, clone, container } = info;

                // Check if source actor is still valid
                if (!sourceActor || sourceActor._destroyed) {
                    toRemove.push(id);
                    return;
                }

                // Check if source is still in the TrayManager
                const trayInfo = trayManager.getItem(id);
                if (!trayInfo) {
                    toRemove.push(id);
                    return;
                }

                // Check if clone still has a valid source
                if (clone && (!clone.source || clone.source !== sourceActor)) {
                    toRemove.push(id);
                    return;
                }

                // Update container visibility based on source
                if (container && sourceActor) {
                    container.visible = sourceActor.visible && sourceActor.width > 0 && sourceActor.height > 0;
                }
            });

            // Remove stale items
            toRemove.forEach(id => {

                this._removeClonedItem(id);
            });
        }

        _addClonedItem(id, sourceActor, sourceItem) {
            if (this._clonedItems.has(id)) return;

            // Validate source actor - skip if invisible or has no size
            if (!sourceActor || !sourceActor.visible || sourceActor.width === 0 || sourceActor.height === 0) {
                // Schedule a retry in case the actor becomes visible later
                GLib.timeout_add(GLib.PRIORITY_LOW, 1000, () => {
                    if (!this._isDestroyed && !this._clonedItems.has(id)) {
                        const info = trayManager.getItem(id);
                        if (info && info.actor.visible && info.actor.width > 0 && info.actor.height > 0) {
                            this._addClonedItem(id, info.actor, info.item);
                        }
                    }
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }

            // Create a container button for interaction
            const container = new St.Button({
                style_class: 'winbar-appindicator-icon',
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            // Create the clone
            const clone = new Clutter.Clone({
                source: sourceActor,
                width: sourceActor.width,
                height: sourceActor.height,
            });

            // Bind size to source and sync visibility
            const sizeId = sourceActor.connect('notify::allocation', () => {
                if (sourceActor.width > 0 && sourceActor.height > 0) {
                    clone.width = sourceActor.width;
                    clone.height = sourceActor.height;
                }
            });

            // Monitor visibility changes
            const visibilityId = sourceActor.connect('notify::visible', () => {
                container.visible = sourceActor.visible && sourceActor.width > 0 && sourceActor.height > 0;
            });

            // Monitor source destruction - remove clone when source is destroyed
            const destroyId = sourceActor.connect('destroy', () => {
                if (!this._isDestroyed) {

                    this._removeClonedItem(id);
                }
            });

            container.add_child(clone);

            // Reposition an opened menu so it appears above this clone on the correct monitor.
            // Note: This is a best-effort attempt - GNOME Shell's BoxPointer may override
            // our positioning on multi-monitor setups.
            const repositionMenuNear = (menu) => {
                if (!menu || !menu.isOpen) return false;

                const boxPointer = menu._boxPointer;
                if (!boxPointer) return false;

                const [mW, mH] = boxPointer.get_size();
                if (mW === 0 || mH === 0) return false;

                const [cX, cY] = container.get_transformed_position();
                const [cW, cH] = container.get_size();

                // Use the winbar's monitor - this is the monitor this taskbar belongs to
                const targetMon = this._winbar._monitor;

                // Calculate position centered above the icon
                let x = cX + cW / 2 - mW / 2;
                let y = cY - mH - MENU_OFFSET_PX;

                // Constrain to target monitor's bounds
                if (x < targetMon.x) x = targetMon.x + 4;
                if (x + mW > targetMon.x + targetMon.width) x = targetMon.x + targetMon.width - mW - 4;
                if (y < targetMon.y) y = cY + cH + 4;
                if (y + mH > targetMon.y + targetMon.height) y = targetMon.y + targetMon.height - mH - 4;

                boxPointer.set_position(Math.floor(x), Math.floor(y));
                return true;
            };

            // Poll until the menu is open, then reposition.  Menus from
            // StatusNotifier / AppIndicator items open asynchronously.
            const scheduleMenuReposition = () => {
                let attempts = 0;
                const tryReposition = () => {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                        if (attempts >= 5) return GLib.SOURCE_REMOVE;
                        attempts++;
                        const menu = sourceItem.menu ||
                            (sourceItem._delegate ? sourceItem._delegate.menu : null);
                        if (menu && menu.isOpen) {
                            const success = repositionMenuNear(menu);
                            // If size is still zero, keep trying
                            if (!success && attempts < 5) {
                                return GLib.SOURCE_CONTINUE;
                            }
                            return GLib.SOURCE_REMOVE;
                        }
                        return GLib.SOURCE_CONTINUE;
                    });
                };
                tryReposition();
            };

            // Helper: wire sourceActor on the menu's BoxPointer so that
            // GNOME Shell's own positioning logic uses the clone container
            // instead of the original icon on the primary monitor.
            // Based on Dash to Panel's approach.
            // Returns the menu if found, null otherwise.
            const setupMenuSourceActor = () => {
                const menu = sourceItem.menu ||
                    (sourceItem._delegate ? sourceItem._delegate.menu : null);
                if (!menu) return null;

                if (menu._boxPointer) {
                    // Store original values for restoration (like Dash to Panel)
                    if (!menu._boxPointer._winbarSourceActor) {
                        menu._boxPointer._winbarSourceActor = menu._boxPointer.sourceActor;
                    }
                    if (menu._boxPointer._winbarOriginalArrowSide === undefined) {
                        menu._boxPointer._winbarOriginalArrowSide = menu._boxPointer._userArrowSide;
                    }

                    // Set our container as the source actor
                    menu._boxPointer.sourceActor = container;
                    // Set arrow to point up (menu appears above bottom panel)
                    menu._boxPointer._userArrowSide = St.Side.BOTTOM;
                    // Mark as modified by winbar and set target monitor for InjectionManager override
                    menu._boxPointer._winbarInPanel = true;
                    menu._boxPointer._winbarTargetMonitor = this._winbar._monitor;

                    // Restore original values when the menu closes
                    const closeId = menu.connect('open-state-changed', (m, open) => {
                        if (!open && menu._boxPointer) {
                            if (menu._boxPointer._winbarSourceActor) {
                                menu._boxPointer.sourceActor = menu._boxPointer._winbarSourceActor;
                                delete menu._boxPointer._winbarSourceActor;
                            }
                            if (menu._boxPointer._winbarOriginalArrowSide !== undefined) {
                                menu._boxPointer._userArrowSide = menu._boxPointer._winbarOriginalArrowSide;
                                delete menu._boxPointer._winbarOriginalArrowSide;
                            }
                            delete menu._boxPointer._winbarInPanel;
                            delete menu._boxPointer._winbarTargetMonitor;
                            menu.disconnect(closeId);
                        }
                    });
                }
                return menu;
            };

            // Left-click
            container.connect('clicked', () => {
                const [containerX, containerY] = container.get_transformed_position();
                const [containerW, containerH] = container.get_size();
                const activateX = Math.floor(containerX + containerW / 2);
                const activateY = Math.floor(containerY + containerH / 2);

                // If the source item has a PopupMenu we can control its
                // positioning directly – this is the only reliable way to
                // get the menu onto this monitor.
                const menu = setupMenuSourceActor();
                if (menu) {
                    if (sourceItem.toggle) sourceItem.toggle();
                    else menu.toggle();
                    scheduleMenuReposition();
                    return;
                }

                // No menu – fall back to delegate activation (D-Bus Activate etc.)
                if (sourceItem._delegate) {
                    const delegate = sourceItem._delegate;
                    if (delegate.Activate) delegate.Activate(activateX, activateY);
                    else if (delegate.SecondaryActivate) delegate.SecondaryActivate(activateX, activateY);
                    else if (delegate.activate) delegate.activate(activateX, activateY);
                    return;
                }

                // Last resort: emit on source actor directly
                if (sourceItem instanceof St.Button) sourceItem.emit('clicked', 0);
                else if (sourceActor.reactive) {
                    const event = Clutter.get_current_event();
                    if (event) {
                        sourceActor.emit('button-press-event', event);
                        sourceActor.emit('button-release-event', event);
                    } else {
                        sourceActor.emit('button-press-event', null);
                        sourceActor.emit('button-release-event', null);
                    }
                }
            });

            // Right-click – open the menu directly if available;
            // emitting synthetic button-press on the source actor does not
            // work because GNOME Shell's StatusNotifier handler only reacts
            // to real input events.
            container.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 3) {
                    const menu = setupMenuSourceActor();
                    if (menu) {
                        menu.open();
                        // Schedule repositioning after menu opens
                        scheduleMenuReposition();
                    }
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            this._appIndicatorContainer.add_child(container);
            this._clonedItems.set(id, { container, clone, sizeId, visibilityId, destroyId, sourceActor });

            // Defer layout update to avoid allocation warnings
            this._deferCall(() => this._updateChevronVisibility());
        }

        _removeClonedItem(id) {
            const info = this._clonedItems.get(id);
            if (!info) return;

            const { container, sizeId, visibilityId, destroyId, sourceActor } = info;

            if (sourceActor && !sourceActor._destroyed) {
                if (sizeId) {
                    try {
                        sourceActor.disconnect(sizeId);
                    } catch (e) { /* Signal may already be disconnected */ }
                }
                if (visibilityId) {
                    try {
                        sourceActor.disconnect(visibilityId);
                    } catch (e) { /* Signal may already be disconnected */ }
                }
                if (destroyId) {
                    try {
                        sourceActor.disconnect(destroyId);
                    } catch (e) { /* Signal may already be disconnected */ }
                }
            }

            if (container && !container._destroyed) {
                container.destroy();
            }
            this._clonedItems.delete(id);

            // Defer layout update
            this._deferCall(() => this._updateChevronVisibility());
        }

        _hijackItem(key, item) {
            // If it's already hijacked, ignore
            if (this._hijackedItems.has(key)) return;

            // Get the container actor
            let actor = item.container || item.actor || item;
            if (!actor) return;

            // Store original parent and index to restore later
            const originalParent = actor.get_parent();
            if (!originalParent) return;

            const originalIndex = originalParent.get_children().indexOf(actor);

            // Store info for restoration
            this._hijackedItems.set(key, {
                item: item,
                actor: actor,
                originalParent: originalParent,
                originalIndex: originalIndex
            });

            // Monitor for actor destruction
            const destroyId = actor.connect('destroy', () => {
                // Remove our style class while the actor is still partly alive
                // to avoid theme_node warnings from any subsequent internal lookups.
                try {
                    if (actor.get_stage()) {
                        actor.remove_style_class_name('winbar-hijacked-tray-item');
                    }
                } catch (e) { /* Actor may already be off stage */ }

                // Remove from our tracking and unregister from TrayManager
                this._hijackedItems.delete(key);
                trayManager.unregisterItem(key);
            });

            // Store destroy handler ID for cleanup
            this._hijackedItems.get(key).destroyId = destroyId;

            // Reparent to our tray
            // Hide before removal to suppress style recalculations during the
            // off-stage gap between remove_child and add_child.
            const wasVisible = actor.visible;
            actor.visible = false;
            originalParent.remove_child(actor);
            this._appIndicatorContainer.add_child(actor);

            // Ensure it's visible
            actor.visible = wasVisible;

            // Add style class to fit in
            actor.add_style_class_name('winbar-hijacked-tray-item');

            // Add event blocker for right-clicks to prevent double menus (app menu + panel menu)
            // We store the ID so we can disconnect it later if needed (though we destroy actor on disable)
            if (!item._winbarRightClickId) {
                // Connect to the ACTOR, not the item wrapper, for events
                item._winbarRightClickId = actor.connect('button-press-event', (actor, event) => {
                    if (event.get_button() === 3) {
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });
            }

            // Force layout update (deferred)
            this._deferCall(() => this._updateChevronVisibility());

            // Register with TrayManager
            trayManager.registerItem(key, item, actor);


        }

        _checkAndHijackGenericActor(actor, side) {
            // This is trickier as we don't have a semantic key. 
            // We need to be careful not to steal core panel elements.
            // For now, we only steal things that look like tray icons/indicators
            // and aren't standard classes.

            // Basic heuristic: check if it's an extension provided indicator
            // This is hard to do reliably without aggressive filtering.
            // Dash to Panel does this by tracking everything added to the panel.

            // For now, we'll rely mainly on statusArea hijacking which covers
            // AppIndicator support and most well-behaved extensions.
        }

        _restoreTrayItems() {
            // Put everything back where we found it
            this._hijackedItems.forEach((info, key) => {
                const { actor, originalParent, originalIndex, destroyId } = info;

                // Disconnect destroy handler
                if (destroyId && actor && !actor._destroyed) {
                    try {
                        actor.disconnect(destroyId);
                    } catch (e) { /* Signal may already be disconnected */ }
                }

                if (actor && !actor._destroyed) {
                    // Hide and remove custom style while still on stage to suppress
                    // theme_node warnings during the off-stage reparenting gap.
                    try {
                        if (actor.get_stage()) {
                            actor.visible = false;
                            actor.remove_style_class_name('winbar-hijacked-tray-item');
                        }
                    } catch (e) { /* Actor may be in limbo */ }

                    if (actor.get_parent() === this._appIndicatorContainer) {
                        this._appIndicatorContainer.remove_child(actor);
                    }

                    // Re-add to original parent if it still exists
                    if (originalParent && !originalParent._destroyed) {
                        // Insert at correct index if possible, otherwise append
                        const childCount = originalParent.get_children().length;
                        const index = Math.min(originalIndex, childCount);
                        originalParent.insert_child_at_index(actor, index);
                        actor.visible = true;
                    }
                }
            });

            this._hijackedItems.clear();
        }

        _onDestroy() {
            this._isDestroyed = true;

            // Cancel pending deferred callbacks to prevent accessing disposed GObjects
            for (const id of this._pendingIdleSources) {
                GLib.source_remove(id);
            }
            this._pendingIdleSources.clear();

            // Cancel allocation listener if init hasn't happened yet
            if (this._initAllocId) {
                this.disconnect(this._initAllocId);
                this._initAllocId = 0;
            }

            if (this._isPrimary) {
                this._restoreTrayItems();
                // Also clear tray manager (unregister involves emitting removed, which is good for secondary monitors)
                // Actually, since we restored items, they are "removed" from our tray, so unregistering is correct.
                // But wait, if we unregister, secondary monitors lose them.
                // If we are destroying because winbar is being disabled/reloaded, that's fine.
                // If we are just destroying ONE monitor's bar but not the extension? 
                // Primary monitor destruction usually implies extension disable or restart.

                // We should unregister all items we own
                this._hijackedItems.forEach((info, key) => {
                    trayManager.unregisterItem(key);
                });
            } else {
                // Secondary monitor cleanup
                if (this._tmAddedId) trayManager.disconnect(this._tmAddedId);
                if (this._tmRemovedId) trayManager.disconnect(this._tmRemovedId);

                // Stop clone validation timer
                if (this._cloneValidationId) {
                    GLib.source_remove(this._cloneValidationId);
                    this._cloneValidationId = null;
                }

                // Destroy clones
                this._clonedItems.forEach((info, id) => {
                    this._removeClonedItem(id);
                });
            }

            // Clean up watchers
            if (this._rightBoxWatcherId) {
                Main.panel._rightBox.disconnect(this._rightBoxWatcherId);
                this._rightBoxWatcherId = null;
            }
            if (this._leftBoxWatcherId) {
                Main.panel._leftBox.disconnect(this._leftBoxWatcherId);
                this._leftBoxWatcherId = null;
            }
            if (this._periodicCheckId) {
                GLib.source_remove(this._periodicCheckId);
                this._periodicCheckId = null;
            }

            super._onDestroy();
        }

        /**
         * Update theme
         */
        updateTheme() {
            const settings = this._extension.getSettings();
            const effectiveMode = getEffectiveThemeMode(settings);
            const isLight = effectiveMode === 2;

            // Update tray icons color
            const iconColor = isLight ? THEME_COLORS.light.iconColor : THEME_COLORS.dark.iconColor;
            if (this._networkIcon) this._networkIcon.set_style(`color: ${iconColor};`);
            if (this._trayVolumeIcon) this._trayVolumeIcon.set_style(`color: ${iconColor};`);
            if (this._trayBatteryIcon) this._trayBatteryIcon.set_style(`color: ${iconColor};`);

            // Update chevron
            if (this._hiddenIconsBtn) {
                const chevronIcon = this._hiddenIconsBtn.get_child();
                if (chevronIcon) chevronIcon.set_style(`color: ${isLight ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)'};`);
            }

            // Update Quick Settings popup - only toggle light/dark class, let CSS handle the rest
            if (this._qsBox) {
                if (isLight) {
                    this._qsBox.add_style_class_name('winbar-qs-light');
                } else {
                    this._qsBox.remove_style_class_name('winbar-qs-light');
                }
            }

            // Update volume button and slider icons
            const sliderIconColor = isLight ? THEME_COLORS.light.iconColor : THEME_COLORS.dark.iconColor;
            if (this._volumeBtn) {
                const volIcon = this._volumeBtn.get_child();
                if (volIcon) volIcon.set_style(`color: ${sliderIconColor};`);
            }
            if (this._brightnessIcon) {
                this._brightnessIcon.set_style(`color: ${sliderIconColor};`);
            }

            // Update battery label
            if (this._batteryLabel) {
                this._batteryLabel.set_style(`color: ${sliderIconColor};`);
            }
            if (this._batteryIcon) {
                this._batteryIcon.set_style(`color: ${sliderIconColor};`);
            }

            // Update toggle tiles
            this._updateToggleTileTheme(this._wifiToggle, isLight);
            this._updateToggleTileTheme(this._bluetoothToggle, isLight);
            this._updateToggleTileTheme(this._airplaneToggle, isLight);
            this._updateToggleTileTheme(this._nightLightToggle, isLight);
            this._updateToggleTileTheme(this._dndToggle, isLight);
            this._updateToggleTileTheme(this._darkModeToggle, isLight);

            // Update clones
            this._appIndicatorContainer.get_children().forEach(child => {
                if (child instanceof St.Button && !child.has_style_class_name('winbar-hijacked-tray-item')) {
                    // It's a clone container (hijacked items have the class)
                    // But we can't style the clone easily (it's a texture).
                    // We can style the container if needed.
                }
            });
        }

        _updateToggleTileTheme(toggle, isLight) {
            if (!toggle) return;

            // Guard against disposed widgets
            try {
                if (this._isDestroyed) return;

                const tileBg = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.06)';
                const labelColor = isLight ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.95)';
                const iconColor = isLight ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.95)';

                toggle.set_style(`
                border-radius: 8px;
                background-color: ${tileBg};
                min-height: 72px;
                min-width: 110px;
                border: none;
            `);

                if (toggle._label) {
                    toggle._label.set_style(`
                    font-size: 11px;
                    font-weight: 500;
                    color: ${labelColor};
                    margin-top: 6px;
                `);
                }
                if (toggle._icon) {
                    toggle._icon.set_style(`color: ${iconColor};`);
                }
            } catch (e) {
                // Widget may have been disposed
            }
        }

        _createHiddenIconsPopup() {
            this._hiddenIconsPopup = new St.BoxLayout({
                style_class: 'winbar-hidden-icons-popup',
                reactive: true,
            });
            this._hiddenIconsPopup.hide();
            Main.layoutManager.addChrome(this._hiddenIconsPopup, { affectsStruts: false });
            addBlurEffect(this._hiddenIconsPopup);
            this._hiddenIconsPopupOpen = false;
            this._overflowIcons = [];
        }

        _toggleHiddenIconsPopup() {
            if (this._hiddenIconsPopupOpen) {
                this._closeHiddenIconsPopup();
            } else {
                this._openHiddenIconsPopup();
            }
        }

        _openHiddenIconsPopup() {
            if (this._hiddenIconsPopupOpen || this._isDestroyed) return;
            this._hiddenIconsPopupOpen = true;

            // Move hidden-by-limit icons from main container into popup
            this._overflowIcons = [];
            const children = [...this._appIndicatorContainer.get_children()];
            for (const child of children) {
                if (!child._hiddenByLimit) continue;
                try {
                    this._appIndicatorContainer.remove_child(child);
                    child._hiddenByLimit = false;
                    child.show();
                    this._hiddenIconsPopup.add_child(child);
                    this._overflowIcons.push(child);
                } catch (e) {
                    // Child may already be disposed
                }
            }

            // Apply theme to popup
            const settings = this._extension.getSettings();
            const effectiveMode = getEffectiveThemeMode(settings);
            const isLight = effectiveMode === 2;
            const bgColor = isLight ? THEME_COLORS.light.bg : THEME_COLORS.dark.bg;
            const borderColor = isLight ? THEME_COLORS.light.border : THEME_COLORS.dark.border;
            this._hiddenIconsPopup.set_style(`
                background-color: ${bgColor};
                border: 1px solid ${borderColor};
                border-radius: 8px;
                padding: 4px 8px;
            `);

            // Position above chevron
            this._hiddenIconsPopup.show();
            this._deferCall(() => {
                if (!this._hiddenIconsPopup.visible) return;
                const [btnX, btnY] = this._hiddenIconsBtn.get_transformed_position();
                const [btnW] = this._hiddenIconsBtn.get_size();
                const [popW, popH] = this._hiddenIconsPopup.get_size();
                const monitor = this._winbar?._monitor || Main.layoutManager.primaryMonitor;

                let x = btnX + btnW / 2 - popW / 2;
                let y = btnY - popH - 8;

                if (x < monitor.x + 4) x = monitor.x + 4;
                if (x + popW > monitor.x + monitor.width - 4) x = monitor.x + monitor.width - popW - 4;
                if (y < monitor.y + 4) y = monitor.y + 4;

                this._hiddenIconsPopup.set_position(Math.round(x), Math.round(y));
            }, GLib.PRIORITY_DEFAULT);

            // Click-outside handler
            this._hiddenIconsCapturedEventId = global.stage.connect('captured-event', (actor, event) => {
                if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                    const [eventX, eventY] = event.get_coords();
                    const [popX, popY] = this._hiddenIconsPopup.get_transformed_position();
                    const [pw, ph] = this._hiddenIconsPopup.get_size();
                    const [bx, by] = this._hiddenIconsBtn.get_transformed_position();
                    const [bw, bh] = this._hiddenIconsBtn.get_size();

                    const inPopup = eventX >= popX && eventX <= popX + pw &&
                        eventY >= popY && eventY <= popY + ph;
                    const inBtn = eventX >= bx && eventX <= bx + bw &&
                        eventY >= by && eventY <= by + bh;

                    if (!inPopup && !inBtn) {
                        this._closeHiddenIconsPopup();
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _closeHiddenIconsPopup() {
            if (!this._hiddenIconsPopupOpen) return;
            this._hiddenIconsPopupOpen = false;

            // Reparent overflow icons back to main container (hidden, to avoid visual flash)
            for (const child of this._overflowIcons) {
                try {
                    // Hide while still in popup (on stage) to avoid theme_node warnings
                    child.hide();
                    child._hiddenByLimit = true;
                    if (child.get_parent() === this._hiddenIconsPopup) {
                        this._hiddenIconsPopup.remove_child(child);
                    }
                    this._appIndicatorContainer.add_child(child);
                } catch (e) {
                    // Child may already be disposed
                }
            }
            this._overflowIcons = [];

            this._hiddenIconsPopup.hide();

            if (this._hiddenIconsCapturedEventId) {
                global.stage.disconnect(this._hiddenIconsCapturedEventId);
                this._hiddenIconsCapturedEventId = null;
            }

            // Re-apply limit
            this._updateChevronVisibility();
        }

        _updateChevronVisibility() {
            if (this._isDestroyed || !this._appIndicatorContainer) return;

            try {
                if (!this.get_stage()) return;
            } catch (e) {
                // Widget may have been disposed from C code
                return;
            }

            // Close popup first to return overflow icons to main container
            if (this._hiddenIconsPopupOpen) {
                this._closeHiddenIconsPopup();
                return; // _closeHiddenIconsPopup calls us again
            }

            let children;
            try {
                children = this._appIndicatorContainer.get_children();
            } catch (e) {
                // Container may have been disposed during shutdown
                return;
            }

            // Filter out any children that have left the stage (e.g. AppIndicator
            // recreated its icon).  Accessing .visible / .show() / .hide() on a
            // widget not in the stage triggers expensive st_widget_get_theme_node
            // warnings and can cause compositor hitches.
            children = children.filter(c => {
                try { return c.get_stage() !== null; } catch (e) { return false; }
            });

            const settings = this._extension.getSettings();
            const showChevron = settings.get_boolean('show-tray-chevron');
            const iconLimit = settings.get_int('tray-icon-limit');

            // First, restore any icons we previously hid due to the limit
            for (const child of children) {
                if (child._hiddenByLimit) {
                    try {
                        child.show();
                    } catch (e) {
                        // Child may already be disposed
                    }
                    child._hiddenByLimit = false;
                }
            }

            // Now count naturally visible icons
            const visibleChildren = children.filter(c => {
                try { return c.visible; } catch (e) { return false; }
            });
            const totalIcons = visibleChildren.length;
            const hasOverflow = totalIcons > iconLimit;

            // Hide icons beyond the limit
            let visibleCount = 0;
            for (const child of children) {
                try {
                    if (!child.visible) continue;
                } catch (e) {
                    continue;
                }
                visibleCount++;
                if (visibleCount > iconLimit) {
                    try {
                        child.hide();
                    } catch (e) {
                        // Child may already be disposed
                        continue;
                    }
                    child._hiddenByLimit = true;
                }
            }

            // Show chevron only when there are overflow icons and the setting allows it
            if (this._hiddenIconsBtn) {
                try {
                    this._hiddenIconsBtn.visible = showChevron && hasOverflow;
                } catch (e) {
                    // Button may have been destroyed already during cleanup
                }
            }
        }

        updateSettings() {
            this._updateChevronVisibility();
        }

        destroy() {
            this._isDestroyed = true;

            // Stop periodic check
            if (this._periodicCheckId) {
                GLib.source_remove(this._periodicCheckId);
                this._periodicCheckId = null;
            }

            // Disconnect box watchers
            if (this._rightBoxWatcherId) {
                Main.panel._rightBox.disconnect(this._rightBoxWatcherId);
                this._rightBoxWatcherId = null;
            }
            if (this._leftBoxWatcherId) {
                Main.panel._leftBox.disconnect(this._leftBoxWatcherId);
                this._leftBoxWatcherId = null;
            }
            // Disconnect old watcher if it existed (backwards compatibility with my previous buggy code)
            if (this._statusAreaWatcherId) {
                try { Main.panel.disconnect(this._statusAreaWatcherId); } catch (e) { /* Signal may already be disconnected */ }
                this._statusAreaWatcherId = null;
            }

            // Restore hijacked items
            this._restoreTrayItems();

            this._disconnectFromWatcher();

            // Disconnect focus window watcher
            if (this._qsFocusWindowId) {
                global.display.disconnect(this._qsFocusWindowId);
                this._qsFocusWindowId = null;
            }

            // Disconnect captured event handler
            if (this._qsCapturedEventId) {
                global.stage.disconnect(this._qsCapturedEventId);
                this._qsCapturedEventId = null;
            }

            if (this._mixerControl) {
                // Disconnect stream sink signals
                const sink = this._mixerControl.get_default_sink();
                if (sink) {
                    if (this._streamChangedId) {
                        sink.disconnect(this._streamChangedId);
                        this._streamChangedId = null;
                    }
                    if (this._streamMuteId) {
                        sink.disconnect(this._streamMuteId);
                        this._streamMuteId = null;
                    }
                }

                // Disconnect mixer control signals
                if (this._mixerStateChangedId) {
                    this._mixerControl.disconnect(this._mixerStateChangedId);
                    this._mixerStateChangedId = null;
                }
                if (this._mixerDefaultSinkChangedId) {
                    this._mixerControl.disconnect(this._mixerDefaultSinkChangedId);
                    this._mixerDefaultSinkChangedId = null;
                }
                if (this._mixerStreamAddedId) {
                    this._mixerControl.disconnect(this._mixerStreamAddedId);
                    this._mixerStreamAddedId = null;
                }
                if (this._mixerStreamRemovedId) {
                    this._mixerControl.disconnect(this._mixerStreamRemovedId);
                    this._mixerStreamRemovedId = null;
                }

                this._mixerControl.close();
                this._mixerControl = null;
            }

            // Null out button references before destroying to prevent access attempts
            this._hiddenIconsBtn = null;

            // Clean up hidden icons popup
            if (this._hiddenIconsCapturedEventId) {
                global.stage.disconnect(this._hiddenIconsCapturedEventId);
                this._hiddenIconsCapturedEventId = null;
            }
            if (this._hiddenIconsPopup) {
                try {
                    // Return any overflow icons before destroying
                    for (const child of (this._overflowIcons || [])) {
                        try {
                            if (child.get_parent() === this._hiddenIconsPopup) {
                                this._hiddenIconsPopup.remove_child(child);
                            }
                            this._appIndicatorContainer.add_child(child);
                        } catch (e) { /* ignore */ }
                    }
                    this._overflowIcons = [];
                    Main.layoutManager.removeChrome(this._hiddenIconsPopup);
                    this._hiddenIconsPopup.destroy();
                } catch (e) { /* Chrome may already be removed */ }
                this._hiddenIconsPopup = null;
            }

            // Null out container reference to prevent deferred callbacks from accessing disposed widget
            this._appIndicatorContainer = null;

            super.destroy();
        }

        _disconnectFromWatcher() {
            // Helper for destroy
        }
    });
