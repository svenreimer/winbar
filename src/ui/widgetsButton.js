import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';
import GWeather from 'gi://GWeather';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { getEffectiveThemeMode, addBlurEffect } from '../utils.js';
import { ANIMATION_TIME, THEME_COLORS } from '../constants.js';

export const WidgetsButton = GObject.registerClass({
    GTypeName: 'WinbarWidgetsButton',
},
    class WidgetsButton extends St.Button {
        _init(extension, winbar) {
            super._init({
                style_class: 'winbar-widgets-button',
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            this._extension = extension;
            this._winbar = winbar;
            this._settings = extension.getSettings();
            this._isOpen = false;
            this._widgetsPanel = null;
            this._weatherInfo = null;
            this._weatherLocation = null;
            this._weatherAvailable = false;
            this._updateTimeoutId = null;

            const box = new St.BoxLayout({
                style_class: 'winbar-widgets-box',
            });
            this.set_child(box);

            // Weather icon
            this._weatherIcon = new St.Icon({
                icon_name: 'weather-few-clouds-symbolic',
                icon_size: 18,
                style_class: 'winbar-weather-icon',
            });
            box.add_child(this._weatherIcon);

            // Temperature label
            this._tempLabel = new St.Label({
                text: '--°',
                style_class: 'winbar-temp-label',
                y_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(this._tempLabel);

            this.connect('clicked', () => this._togglePanel());

            // Initialize weather
            this._initWeather();
        }

        _initWeather() {
            try {
                // Try to get location from GNOME Weather settings
                this._loadWeatherLocation();

                if (!this._weatherLocation) {
                    // No location configured, show placeholder
                    log('Winbar: No weather location configured');
                    return;
                }

                // Create weather info object - must set application_id before providers
                this._weatherInfo = new GWeather.Info({
                    location: this._weatherLocation,
                });

                // Set application_id first, then enabled_providers
                this._weatherInfo.set_application_id('org.gnome.shell.extensions.winbar');
                this._weatherInfo.set_contact_info('https://github.com/');
                this._weatherInfo.set_enabled_providers(
                    GWeather.Provider.METAR | GWeather.Provider.MET_NO | GWeather.Provider.OWM
                );

                // Connect to weather update signal
                this._weatherUpdatedId = this._weatherInfo.connect('updated', () => {
                    this._onWeatherUpdated();
                });

                // Initial update
                this._weatherInfo.update();
                this._weatherAvailable = true;

                // Schedule periodic updates (every 30 minutes)
                this._updateTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1800, () => {
                    if (this._weatherInfo) {
                        this._weatherInfo.update();
                    }
                    return GLib.SOURCE_CONTINUE;
                });

            } catch (e) {
                log(`Winbar: Weather initialization failed: ${e.message}`);
                this.hide();
            }
        }

        _loadWeatherLocation() {
            const world = GWeather.Location.get_world();
            if (!world) return;

            try {
                // First try org.gnome.shell.weather (GNOME Shell's weather)
                const shellWeatherSchema = 'org.gnome.shell.weather';
                const shellWeatherSettings = new Gio.Settings({ schema_id: shellWeatherSchema });
                const locationsVariant = shellWeatherSettings.get_value('locations');

                if (locationsVariant.n_children() > 0) {
                    // Get the first location variant and unwrap it
                    const firstLocVariant = locationsVariant.get_child_value(0);
                    // The variant is wrapped as 'v' containing '(uv)', need to unwrap
                    const innerVariant = firstLocVariant.get_variant();
                    this._weatherLocation = world.deserialize(innerVariant);
                    if (this._weatherLocation) return;
                }
            } catch (e) {
                // Shell weather settings not available
                log(`Winbar: Shell weather settings error: ${e.message}`);
            }

            try {
                // Try org.gnome.Weather (GNOME Weather app)
                const weatherSchema = 'org.gnome.Weather';
                const weatherSettings = new Gio.Settings({ schema_id: weatherSchema });
                const locationsVariant = weatherSettings.get_value('locations');

                if (locationsVariant.n_children() > 0) {
                    const firstLocVariant = locationsVariant.get_child_value(0);
                    const innerVariant = firstLocVariant.get_variant();
                    this._weatherLocation = world.deserialize(innerVariant);
                    if (this._weatherLocation) return;
                }
            } catch (e) {
                // Weather app settings not available
                log(`Winbar: Weather app settings error: ${e.message}`);
            }

            try {
                // Try GWeather4 default location
                const gweatherSchema = 'org.gnome.GWeather4';
                const gweatherSettings = new Gio.Settings({ schema_id: gweatherSchema });
                const defaultLoc = gweatherSettings.get_value('default-location');

                this._weatherLocation = world.deserialize(defaultLoc);
                if (this._weatherLocation) return;
            } catch (e) {
                // GWeather4 settings not available
                log(`Winbar: GWeather4 settings error: ${e.message}`);
            }
        }

        _getConditionFromIcon(iconName) {
            // Map icon names to human-readable conditions
            const iconConditions = {
                'weather-clear': _('Clear'),
                'weather-clear-night': _('Clear'),
                'weather-few-clouds': _('Partly Cloudy'),
                'weather-few-clouds-night': _('Partly Cloudy'),
                'weather-clouds': _('Cloudy'),
                'weather-clouds-night': _('Cloudy'),
                'weather-overcast': _('Overcast'),
                'weather-fog': _('Foggy'),
                'weather-showers': _('Showers'),
                'weather-showers-scattered': _('Scattered Showers'),
                'weather-snow': _('Snow'),
                'weather-snow-rain': _('Sleet'),
                'weather-storm': _('Stormy'),
                'weather-severe-alert': _('Severe Weather'),
                'weather-windy': _('Windy'),
            };

            // Remove -symbolic suffix if present
            const baseName = iconName?.replace('-symbolic', '') || '';
            return iconConditions[baseName] || _('Unknown');
        }

        _onWeatherUpdated() {
            if (!this._weatherInfo || !this._weatherInfo.is_valid()) {
                this._tempLabel.set_text('--°');
                this._weatherIcon.set_icon_name('weather-severe-alert-symbolic');
                return;
            }

            try {
                // Update taskbar button
                const iconName = this._weatherInfo.get_symbolic_icon_name();
                this._weatherIcon.set_icon_name(iconName || 'weather-few-clouds-symbolic');

                const temp = this._getTemperatureString();
                this._tempLabel.set_text(temp);

                // Update panel if open
                if (this._isOpen && this._panelWeatherIcon) {
                    this._panelWeatherIcon.set_icon_name(iconName || 'weather-few-clouds-symbolic');
                    this._panelTempLabel.set_text(temp);
                    this._panelConditionLabel.set_text(this._getConditionFromIcon(iconName));
                    this._panelLocationLabel.set_text(this._weatherInfo.get_location_name() || _('Unknown location'));
                }
            } catch (e) {
                log(`Winbar: Weather update failed: ${e.message}`);
            }
        }

        _getTemperatureString() {
            if (!this._weatherInfo) return '--°';

            try {
                // Get temperature in user's preferred unit
                const [valid, temp] = this._weatherInfo.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
                if (valid) {
                    // Get unit preference
                    let unitSymbol = 'Â°';
                    try {
                        const gweatherSettings = new Gio.Settings({ schema_id: 'org.gnome.GWeather4' });
                        const unit = gweatherSettings.get_string('temperature-unit');
                        if (unit === 'fahrenheit') {
                            const [fValid, fTemp] = this._weatherInfo.get_value_temp(GWeather.TemperatureUnit.FAHRENHEIT);
                            if (fValid) return `${Math.round(fTemp)}°F`;
                        }
                    } catch (e) { /* GWeather4 settings schema may not be available */ }

                    // Default to Celsius
                    const [cValid, cTemp] = this._weatherInfo.get_value_temp(GWeather.TemperatureUnit.CENTIGRADE);
                    if (cValid) return `${Math.round(cTemp)}°C`;

                    return `${Math.round(temp)}°`;
                }
            } catch (e) {
                log(`Winbar: Temperature conversion failed: ${e.message}`);
            }
            return '--Â°';
        }

        _togglePanel() {
            if (this._isOpen) {
                this._closePanel();
            } else {
                this._openPanel();
            }
        }

        _openPanel() {
            if (this._isOpen) return;
            this._isOpen = true;

            // Get scale factor for HiDPI support
            const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

            // Get theme for background color
            const effectiveMode = getEffectiveThemeMode(this._settings);
            const isLight = effectiveMode === 2;
            const bgColor = isLight ? THEME_COLORS.light.bg : THEME_COLORS.dark.bg;
            const borderColor = isLight ? THEME_COLORS.light.border : THEME_COLORS.dark.border;

            // Create the widgets panel (like StartMenu's _container)
            this._widgetsPanel = new St.BoxLayout({
                style_class: 'winbar-widgets-panel',
                vertical: true,
                reactive: true,
            });

            // Apply inline style like StartMenu
            this._widgetsPanel.set_style(`
            background-color: ${bgColor};
            border-radius: 12px;
            border: 1px solid ${borderColor};
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            padding: 16px;
        `);

            // Toggle light mode class for CSS-styled child elements
            if (isLight) {
                this._widgetsPanel.add_style_class_name('winbar-widgets-panel-light');
            }

            // Add blur effect for modern frosted glass appearance (like StartMenu)
            addBlurEffect(this._widgetsPanel);

            // Position above the button - scale dimensions for HiDPI
            const [btnX, btnY] = this.get_transformed_position();
            const [btnW, btnH] = this.get_size();
            const panelWidth = Math.round(300 * scaleFactor);
            const panelHeight = Math.round(180 * scaleFactor);
            const margin = Math.round(12 * scaleFactor);

            const monitor = this._winbar?._monitor || Main.layoutManager.primaryMonitor;
            let x = Math.max(monitor.x + margin, Math.min(btnX + btnW / 2 - panelWidth / 2, monitor.x + monitor.width - panelWidth - margin));
            let y = btnY - panelHeight - margin;

            this._widgetsPanel.set_position(x, y);
            this._widgetsPanel.set_size(panelWidth, panelHeight);

            // Build panel content
            this._buildPanelContent();

            // Add to chrome
            Main.layoutManager.addChrome(this._widgetsPanel, {
                affectsInputRegion: true,
            });

            // Set initial state - invisible and slightly below
            this._widgetsPanel.opacity = 0;
            this._widgetsPanel.translation_y = Math.round(20 * scaleFactor);

            // Delay animation slightly to ensure actor is fully mapped (X11 compatibility, like StartMenu)
            GLib.timeout_add(GLib.PRIORITY_HIGH, 16, () => {
                if (!this._widgetsPanel) return GLib.SOURCE_REMOVE;

                this._widgetsPanel.ease({
                    opacity: 255,
                    translation_y: 0,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                return GLib.SOURCE_REMOVE;
            });

            // Close on click outside
            this._capturedEventId = global.stage.connect('captured-event', (actor, event) => {
                if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                    const [evX, evY] = event.get_coords();
                    const [panelX, panelY] = this._widgetsPanel.get_transformed_position();
                    const [panelW, panelH] = this._widgetsPanel.get_size();

                    // Check if click is on the button
                    if (evX >= btnX && evX <= btnX + btnW && evY >= btnY && evY <= btnY + btnH) {
                        return Clutter.EVENT_PROPAGATE;
                    }

                    // Check if click is outside panel
                    if (evX < panelX || evX > panelX + panelW || evY < panelY || evY > panelY + panelH) {
                        this._closePanel();
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Close when window gets focus
            this._focusWindowChangedId = global.display.connect('notify::focus-window', () => {
                const focusWindow = global.display.get_focus_window();
                if (focusWindow && this._isOpen) {
                    this._closePanel();
                }
            });
        }

        _closePanel() {
            if (!this._isOpen) return;
            this._isOpen = false;

            if (this._capturedEventId) {
                global.stage.disconnect(this._capturedEventId);
                this._capturedEventId = null;
            }

            if (this._focusWindowChangedId) {
                global.display.disconnect(this._focusWindowChangedId);
                this._focusWindowChangedId = null;
            }

            // Clear panel references
            this._panelWeatherIcon = null;
            this._panelTempLabel = null;
            this._panelConditionLabel = null;
            this._panelLocationLabel = null;

            if (this._widgetsPanel) {
                const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
                this._widgetsPanel.ease({
                    opacity: 0,
                    translation_y: Math.round(20 * scaleFactor),
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        if (this._widgetsPanel) {
                            try {
                                Main.layoutManager.removeChrome(this._widgetsPanel);
                            } catch (e) { /* Chrome may already be removed */ }
                            this._widgetsPanel.destroy();
                            this._widgetsPanel = null;
                        }
                    }
                });
            }
        }

        _buildPanelContent() {
            // Weather widget directly in panel (no intermediate containers)
            this._buildWeatherWidget(this._widgetsPanel);
        }

        _buildWeatherWidget(container) {
            const widget = new St.BoxLayout({
                style_class: 'winbar-widget-card winbar-weather-widget',
                vertical: true,
                x_expand: true,
                y_expand: true,
                reactive: true,
            });
            container.add_child(widget);

            // Make widget clickable to open GNOME Weather
            widget.connect('button-press-event', () => {
                this._closePanel();
                try {
                    const app = Shell.AppSystem.get_default().lookup_app('org.gnome.Weather.desktop');
                    if (app) {
                        app.activate();
                    }
                } catch (e) { /* Weather app may not be installed */ }
                return Clutter.EVENT_PROPAGATE;
            });

            // Get scale factor for HiDPI support
            const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

            const header = new St.BoxLayout({
                style_class: 'winbar-widget-card-header',
            });
            widget.add_child(header);

            // Get current weather data
            let iconName = 'weather-few-clouds-symbolic';
            let tempText = '--°';
            let conditionText = _('Loading...');
            let locationText = _('Loading...');

            if (this._weatherInfo && this._weatherInfo.is_valid()) {
                iconName = this._weatherInfo.get_symbolic_icon_name() || 'weather-few-clouds-symbolic';
                tempText = this._getTemperatureString();
                conditionText = this._getConditionFromIcon(iconName);
                locationText = this._weatherInfo.get_location_name() || _('Unknown location');
            } else if (!this._weatherAvailable) {
                conditionText = _('Weather unavailable');
                locationText = _('Configure in GNOME Weather');
            }

            this._panelWeatherIcon = new St.Icon({
                icon_name: iconName,
                icon_size: Math.round(48 * scaleFactor),
                style_class: 'winbar-widget-weather-icon',
            });
            header.add_child(this._panelWeatherIcon);

            const infoBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            header.add_child(infoBox);

            this._panelTempLabel = new St.Label({
                text: tempText,
                style_class: 'winbar-widget-temp-large',
            });
            infoBox.add_child(this._panelTempLabel);

            this._panelConditionLabel = new St.Label({
                text: conditionText,
                style_class: 'winbar-widget-condition',
            });
            infoBox.add_child(this._panelConditionLabel);

            this._panelLocationLabel = new St.Label({
                text: locationText,
                style_class: 'winbar-widget-location',
            });
            widget.add_child(this._panelLocationLabel);

            // Add hint to click
            const hintLabel = new St.Label({
                text: _('Click to open Weather'),
                style_class: 'winbar-widget-hint',
            });
            widget.add_child(hintLabel);
        }

        updateTheme() {
            // Guard against disposed objects
            if (!this._weatherIcon || !this._tempLabel || !this._settings) return;

            try {
                const effectiveMode = getEffectiveThemeMode(this._settings);
                const isLight = effectiveMode === 2;

                // Update weather icon and temp label colors
                const textColor = isLight ? '#000000' : '#ffffff';

                this._weatherIcon.set_style(`color: -st-accent-color;`);
                this._tempLabel.set_style(`color: ${textColor};`);
            } catch (e) {
                // Ignore errors during cleanup
            }
        }

        destroy() {
            this._closePanel();

            // Clean up weather info
            if (this._weatherUpdatedId && this._weatherInfo) {
                this._weatherInfo.disconnect(this._weatherUpdatedId);
                this._weatherUpdatedId = null;
            }

            if (this._updateTimeoutId) {
                GLib.source_remove(this._updateTimeoutId);
                this._updateTimeoutId = null;
            }

            if (this._weatherInfo) {
                this._weatherInfo.abort();
                this._weatherInfo = null;
            }

            this._weatherLocation = null;

            // Clear references before parent destroy
            this._extension = null;
            this._settings = null;
            this._weatherIcon = null;
            this._tempLabel = null;
            super.destroy();
        }
    });
