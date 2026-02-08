
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { getEffectiveThemeMode, addBlurEffect } from '../utils.js';
import {
    ANIMATION_TIME,
    ANIMATION_FRAME_DELAY,
    PREVIEW_THUMBNAIL_WIDTH,
    PREVIEW_THUMBNAIL_HEIGHT,
    PREVIEW_CLOSE_DELAY_MS,
    PREVIEW_PEEK_DELAY_MS,
    PREVIEW_PEEK_DIM_OPACITY,
    THEME_COLORS,
} from '../constants.js';

/**
 * WindowPreviewMenu - Shows window previews on hover
 */
export const WindowPreviewMenu = GObject.registerClass({
    GTypeName: 'WinbarWindowPreviewMenu',
},
    class WindowPreviewMenu extends St.Widget {
        _init(sourceActor, windows, settings, monitor) {
            super._init({
                style_class: 'winbar-preview-menu',
                reactive: true,
                track_hover: true,
                layout_manager: new Clutter.BoxLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    spacing: 8,
                }),
            });

            this._sourceActor = sourceActor;
            this._windows = windows;
            this._settings = settings;
            this._monitor = monitor || Main.layoutManager.primaryMonitor;
            this._isOpen = false;
            this._closeTimeout = null;
            this._hovered = false;

            // Apply theme-aware styling like StartMenu
            this._applyThemeStyle();

            // Add blur effect for modern frosted glass appearance
            addBlurEffect(this);

            Main.layoutManager.addChrome(this);

            windows.forEach(win => {
                const preview = new WindowPreview(win, this);
                this.add_child(preview);
            });

            this.connect('enter-event', () => {
                this._hovered = true;
                this.cancelClose();
            });

            this.connect('leave-event', () => {
                this._hovered = false;
                this.scheduleClose();
            });
        }

        _applyThemeStyle() {
            const effectiveMode = getEffectiveThemeMode(this._settings);
            const isLight = effectiveMode === 2;
            const bgColor = isLight ? THEME_COLORS.light.bg : THEME_COLORS.dark.bg;
            const borderColor = isLight ? THEME_COLORS.light.border : THEME_COLORS.dark.border;

            this.set_style(`
            background-color: ${bgColor};
            border-radius: 12px;
            border: 1px solid ${borderColor};
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            padding: 12px;
        `);

            // Toggle light mode class for child element styling
            if (isLight) {
                this.add_style_class_name('winbar-preview-menu-light');
            } else {
                this.remove_style_class_name('winbar-preview-menu-light');
            }
        }

        cancelClose() {
            if (this._closeTimeout) {
                GLib.source_remove(this._closeTimeout);
                this._closeTimeout = null;
            }
        }

        scheduleClose() {
            this.cancelClose();

            this._closeTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PREVIEW_CLOSE_DELAY_MS, () => {
                this._closeTimeout = null;
                // Check if cursor is over this menu or the source button
                if (!this._hovered && !this._sourceActor.hover) {
                    this.close();
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        open() {
            if (this._isOpen)
                return;

            this._isOpen = true;

            // Position above the source actor
            const [x, y] = this._sourceActor.get_transformed_position();
            const [width, height] = this._sourceActor.get_size();

            // Calculate position centered on button
            let posX = x + width / 2 - this.width / 2;
            let posY = y - this.height - 10;

            // Constrain to monitor bounds
            const monitor = this._monitor;
            posX = Math.max(monitor.x + 10, Math.min(posX, monitor.x + monitor.width - this.width - 10));
            posY = Math.max(monitor.y + 10, Math.min(posY, monitor.y + monitor.height - this.height - 10));

            this.set_position(posX, posY);

            this.show();

            // Set initial state
            this.opacity = 0;
            this.translation_y = 20;

            // Delay animation slightly for X11 compatibility (like StartMenu)
            GLib.timeout_add(GLib.PRIORITY_HIGH, ANIMATION_FRAME_DELAY, () => {
                if (!this.get_stage()) return GLib.SOURCE_REMOVE; // Safety check

                this.ease({
                    opacity: 255,
                    translation_y: 0,
                    duration: ANIMATION_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                return GLib.SOURCE_REMOVE;
            });
        }

        close() {
            if (!this._isOpen)
                return;

            this._isOpen = false;
            this.cancelClose();

            // Cancel any active window peeking
            this.get_children().forEach(child => {
                if (child._cancelWindowPeek) {
                    child._cancelWindowPeek();
                }
            });

            // Clear reference in source actor
            if (this._sourceActor && this._sourceActor._previewMenu === this) {
                this._sourceActor._previewMenu = null;
            }

            // Animate close with slide down (like StartMenu)
            this.ease({
                opacity: 0,
                translation_y: 20,
                duration: ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => this.destroy(),
            });
        }
    });

/**
 * WindowPreview - Individual window preview thumbnail
 */
export const WindowPreview = GObject.registerClass({
    GTypeName: 'WinbarWindowPreview',
},
    class WindowPreview extends St.Button {
        _init(window, parentMenu) {
            super._init({
                style_class: 'winbar-window-preview',
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            this._window = window;
            this._parentMenu = parentMenu;
            this._peekTimeoutId = null;
            this._isPeeking = false;
            this._isClosing = false;

            const box = new St.BoxLayout({
                vertical: true,
                style_class: 'winbar-preview-box',
            });
            this.set_child(box);

            // Window title with close button
            const titleBar = new St.BoxLayout({
                style_class: 'winbar-preview-titlebar',
            });
            box.add_child(titleBar);

            const title = new St.Label({
                text: window.get_title() || _('Untitled'),
                style_class: 'winbar-preview-title',
                x_expand: true,
            });
            titleBar.add_child(title);

            const closeBtn = new St.Button({
                style_class: 'winbar-preview-close',
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: 16,
                }),
            });
            closeBtn.connect('clicked', () => {
                // Mark as closing to prevent any further peek operations
                this._isClosing = true;
                // Restore opacity immediately before closing
                if (this._isPeeking) {
                    this._hideWindowPeek(true); // immediate restore
                }
                this._window.delete(global.get_current_time());
                this.destroy();
            });
            titleBar.add_child(closeBtn);

            // Thumbnail
            this._thumbnail = new St.Widget({
                style_class: 'winbar-preview-thumbnail',
                width: PREVIEW_THUMBNAIL_WIDTH,
                height: PREVIEW_THUMBNAIL_HEIGHT,
            });
            box.add_child(this._thumbnail);

            // Create clone of window
            this._createThumbnail();

            this.connect('clicked', () => {
                this._window.activate(global.get_current_time());
                this._parentMenu.close();
            });

            this.connect('button-press-event', (actor, event) => {
                if (event.get_button() === Clutter.BUTTON_MIDDLE) {
                    // Mark as closing to prevent any further peek operations
                    this._isClosing = true;
                    // Restore opacity immediately before closing
                    if (this._isPeeking) {
                        this._hideWindowPeek(true); // immediate restore
                    }
                    this._window.delete(global.get_current_time());
                    this.destroy();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            this.connect('enter-event', () => {
                this._scheduleWindowPeek();
            });

            this.connect('leave-event', () => {
                this._cancelWindowPeek();
            });
        }

        _scheduleWindowPeek() {
            if (this._isClosing)
                return;

            this._cancelWindowPeek();

            this._peekTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PREVIEW_PEEK_DELAY_MS, () => {
                this._peekTimeoutId = null;
                this._showWindowPeek();
                return GLib.SOURCE_REMOVE;
            });
        }

        _cancelWindowPeek() {
            if (this._peekTimeoutId) {
                GLib.Source.remove(this._peekTimeoutId);
                this._peekTimeoutId = null;
            }

            if (this._isPeeking && !this._isClosing) {
                this._hideWindowPeek();
            }
        }

        _showWindowPeek() {
            if (this._isPeeking)
                return;

            this._isPeeking = true;

            // Dim all windows except the one being previewed
            const allWindows = global.get_window_actors();
            allWindows.forEach(actor => {
                const window = actor.meta_window;
                if (window && window !== this._window && !window.is_override_redirect()) {
                    actor.ease({
                        opacity: PREVIEW_PEEK_DIM_OPACITY,
                        duration: ANIMATION_TIME,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            });

            // Ensure the target window is fully visible
            const targetActor = this._window.get_compositor_private();
            if (targetActor) {
                targetActor.ease({
                    opacity: 255,
                    duration: ANIMATION_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }

        _hideWindowPeek(immediate = false) {
            if (!this._isPeeking)
                return;

            this._isPeeking = false;

            // Restore opacity for all windows
            const allWindows = global.get_window_actors();
            allWindows.forEach(actor => {
                // Stop any ongoing animations first
                actor.remove_all_transitions();

                if (immediate) {
                    // Set opacity immediately without animation
                    actor.opacity = 255;
                } else {
                    // Animate opacity restoration
                    actor.ease({
                        opacity: 255,
                        duration: ANIMATION_TIME,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            });
        }

        _createThumbnail() {
            const windowActor = this._window.get_compositor_private();
            if (!windowActor)
                return;

            const clone = new Clutter.Clone({
                source: windowActor,
                reactive: false,
            });

            // Scale to fit
            const [winWidth, winHeight] = windowActor.get_size();
            const scale = Math.min(PREVIEW_THUMBNAIL_WIDTH / winWidth, PREVIEW_THUMBNAIL_HEIGHT / winHeight);
            clone.set_scale(scale, scale);

            this._thumbnail.add_child(clone);
        }

        destroy() {
            this._cancelWindowPeek();
            super.destroy();
        }
    });
