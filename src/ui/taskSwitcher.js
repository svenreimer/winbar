/**
 * Task Switcher - Windows 11 style Alt+Tab
 * 
 * Based on GNOME Shell's SwitcherPopup pattern for proper modal handling.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ANIMATION_TIME = 200;
const THUMBNAIL_WIDTH = 240;
const THUMBNAIL_HEIGHT = 160;
const MAX_CONTAINER_WIDTH = 1400;

/**
 * Get primary modifier from mask
 */
function primaryModifier(mask) {
    if (mask === 0)
        return 0;

    let primary = 1;
    while (mask > 1) {
        mask >>= 1;
        primary <<= 1;
    }
    return primary;
}

/**
 * Get the monitor where the mouse pointer is
 */
function getCurrentMonitor() {
    const [x, y] = global.get_pointer();
    const monitors = Main.layoutManager.monitors;
    
    for (let i = 0; i < monitors.length; i++) {
        const monitor = monitors[i];
        if (x >= monitor.x && x < monitor.x + monitor.width &&
            y >= monitor.y && y < monitor.y + monitor.height) {
            return i;
        }
    }
    
    // Fallback to primary monitor
    return Main.layoutManager.primaryIndex;
}

/**
 * TaskSwitcher - Main switcher popup
 */
export const TaskSwitcher = GObject.registerClass({
    GTypeName: 'WinbarTaskSwitcher',
}, class TaskSwitcher extends St.Widget {
    _init(extension) {
        super._init({
            style_class: 'winbar-task-switcher',
            reactive: true,
            visible: false,
            layout_manager: new Clutter.BinLayout(),
        });

        this._extension = extension;
        this._settings = extension.getSettings();
        this._windows = [];
        this._thumbnails = [];
        this._selectedIndex = 0;
        this._haveModal = false;
        this._grab = null;
        this._modifierMask = 0;

        this._setupUI();

        // Add to uiGroup like GNOME's SwitcherPopup does
        Main.uiGroup.add_child(this);

        // Close on system modal
        Main.layoutManager.connectObject(
            'system-modal-opened', () => this._destroy(), this);
    }

    _setupUI() {
        // Background overlay (semi-transparent)
        this._overlay = new St.Widget({
            style_class: 'winbar-task-switcher-overlay',
            reactive: true,
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._overlay);
        
        // Click on overlay to close
        this._overlay.connect('button-press-event', () => {
            this._fadeAndDestroy();
            return Clutter.EVENT_STOP;
        });

        // Main container (centered on monitor)
        this._container = new St.BoxLayout({
            style_class: 'winbar-task-switcher-container',
            vertical: false,  // Horizontal layout like Windows 11
            x_expand: false,
            y_expand: false,
        });
        this.add_child(this._container);

        // Window list container (no scroll view - Windows 11 doesn't scroll)
        this._windowList = new St.BoxLayout({
            style_class: 'winbar-task-switcher-list',
        });
        this._container.add_child(this._windowList);
    }

    _getWindowList() {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = [];
        
        // Check if we should filter by current monitor
        const currentMonitorOnly = this._settings.get_boolean('task-switcher-current-monitor-only');
        const currentMonitorIndex = currentMonitorOnly ? getCurrentMonitor() : -1;

        global.get_window_actors().forEach(actor => {
            const window = actor.get_meta_window();
            if (!window) return;
            
            if (window.get_window_type() !== Meta.WindowType.NORMAL) return;
            if (window.is_skip_taskbar()) return;
            if (!window.located_on_workspace(workspace)) return;
            
            // Filter by current monitor if enabled
            if (currentMonitorOnly && window.get_monitor() !== currentMonitorIndex) return;
            
            windows.push(window);
        });

        // Sort by most recently focused
        windows.sort((a, b) => b.get_user_time() - a.get_user_time());

        return windows;
    }

    show(backward, binding, mask) {
        if (this._windows.length > 0) {
            // Already open, just cycle
            this._selectNext(backward);
            return true;
        }

        this._windows = this._getWindowList();
        
        if (this._windows.length === 0) {
            return false;
        }

        // Grab modal
        const grab = Main.pushModal(this);
        if (!grab) {
            log('[Winbar] Task switcher: Failed to get modal grab');
            return false;
        }
        this._grab = grab;
        this._haveModal = true;
        this._modifierMask = primaryModifier(mask);

        // Build the window list UI
        this._buildWindowList();
        
        // Select initial window
        if (backward && this._windows.length > 1) {
            this._selectedIndex = this._windows.length - 1;
        } else {
            this._selectedIndex = this._windows.length > 1 ? 1 : 0;
        }
        this._updateSelection();

        // Position on current monitor
        this._positionOnMonitor();

        // Show with animation
        this.opacity = 0;
        this.visible = true;
        
        // Scale up animation like Windows 11
        this._container.set_pivot_point(0.5, 0.5);
        this._container.scale_x = 0.95;
        this._container.scale_y = 0.95;
        
        this.ease({
            opacity: 255,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        
        this._container.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Check if modifier was already released (race condition)
        if (this._modifierMask) {
            const [x_, y_, mods] = global.get_pointer();
            if (!(mods & this._modifierMask)) {
                this._finish(global.get_current_time());
                return true;
            }
        }

        return true;
    }

    _positionOnMonitor() {
        // Get the monitor where the mouse pointer is
        const monitorIndex = getCurrentMonitor();
        const monitor = Main.layoutManager.monitors[monitorIndex];
        
        if (!monitor) return;
        
        // Set widget to cover full screen
        this.set_position(0, 0);
        this.set_size(global.stage.width, global.stage.height);
        
        // Set overlay to cover the current monitor only
        this._overlay.set_position(monitor.x, monitor.y);
        this._overlay.set_size(monitor.width, monitor.height);
        
        // Get container size and center on the monitor
        const [, natWidth] = this._container.get_preferred_width(-1);
        const [, natHeight] = this._container.get_preferred_height(-1);
        
        const containerWidth = Math.min(natWidth, monitor.width - 80, MAX_CONTAINER_WIDTH);
        const containerHeight = Math.min(natHeight, monitor.height - 80);
        
        this._container.set_size(containerWidth, containerHeight);
        this._container.set_position(
            monitor.x + Math.floor((monitor.width - containerWidth) / 2),
            monitor.y + Math.floor((monitor.height - containerHeight) / 2)
        );
    }

    _calculateThumbnailSize() {
        // Get current monitor
        const monitorIndex = getCurrentMonitor();
        const monitor = Main.layoutManager.monitors[monitorIndex];
        if (!monitor) return { width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT };

        const numWindows = this._windows.length;
        const containerPadding = 40; // Left + right padding
        const itemSpacing = 8;
        const itemPadding = 16; // Padding inside each item
        const headerHeight = 32; // Height for icon + title header
        
        // Calculate available width for thumbnails
        const maxContainerWidth = Math.min(monitor.width - 100, MAX_CONTAINER_WIDTH);
        const availableWidth = maxContainerWidth - containerPadding;
        
        // Calculate thumbnail width to fit all windows without scrolling
        const totalSpacing = itemSpacing * (numWindows - 1);
        const totalItemPadding = itemPadding * numWindows;
        const thumbnailWidth = Math.floor((availableWidth - totalSpacing - totalItemPadding) / numWindows);
        
        // Clamp to reasonable sizes
        const clampedWidth = Math.max(160, Math.min(280, thumbnailWidth));
        
        // Calculate height based on 16:10 aspect ratio
        const thumbnailHeight = Math.floor(clampedWidth * 0.625);
        
        return { width: clampedWidth, height: thumbnailHeight };
    }

    _buildWindowList() {
        this._windowList.destroy_all_children();
        this._thumbnails = [];

        const { width: thumbWidth, height: thumbHeight } = this._calculateThumbnailSize();

        this._windows.forEach((window, index) => {
            const item = new TaskSwitcherItem(window, this._settings, thumbWidth, thumbHeight);
            item.connect('clicked', () => {
                this._selectedIndex = index;
                this._finish(global.get_current_time());
            });
            this._windowList.add_child(item);
            this._thumbnails.push(item);
        });
    }

    _selectNext(backward) {
        if (this._windows.length === 0) return;

        if (backward) {
            this._selectedIndex--;
            if (this._selectedIndex < 0)
                this._selectedIndex = this._windows.length - 1;
        } else {
            this._selectedIndex++;
            if (this._selectedIndex >= this._windows.length)
                this._selectedIndex = 0;
        }

        this._updateSelection();
    }

    _updateSelection() {
        this._thumbnails.forEach((thumb, index) => {
            if (index === this._selectedIndex) {
                thumb.add_style_pseudo_class('selected');
            } else {
                thumb.remove_style_pseudo_class('selected');
            }
        });
    }

    _finish(timestamp) {
        const window = this._windows[this._selectedIndex];
        this._fadeAndDestroy();

        if (window) {
            const workspace = window.get_workspace();
            if (workspace) {
                workspace.activate_with_focus(window, timestamp);
            }
            window.activate(timestamp);
        }
    }

    // Handle key press - this is called automatically when we have modal
    vfunc_key_press_event(event) {
        const keysym = event.get_key_symbol();

        switch (keysym) {
            case Clutter.KEY_Tab:
            case Clutter.KEY_ISO_Left_Tab: {
                const state = event.get_state();
                const backward = (state & Clutter.ModifierType.SHIFT_MASK) !== 0 ||
                                keysym === Clutter.KEY_ISO_Left_Tab;
                this._selectNext(backward);
                return Clutter.EVENT_STOP;
            }

            case Clutter.KEY_Left:
                this._selectNext(true);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Right:
                this._selectNext(false);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter:
            case Clutter.KEY_space:
                this._finish(event.get_time());
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Escape:
                this._fadeAndDestroy();
                return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_STOP;
    }

    // Handle key release - detect Alt/Meta release
    vfunc_key_release_event(event) {
        if (this._modifierMask) {
            const [x_, y_, mods] = global.get_pointer();
            const state = mods & this._modifierMask;

            if (state === 0) {
                this._finish(event.get_time());
            }
        }

        return Clutter.EVENT_STOP;
    }

    _popModal() {
        if (this._haveModal) {
            Main.popModal(this._grab);
            this._grab = null;
            this._haveModal = false;
        }
    }

    _fadeAndDestroy() {
        this._popModal();

        if (this.opacity > 0) {
            this.ease({
                opacity: 0,
                duration: ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => this._destroy(),
            });
        } else {
            this._destroy();
        }
    }

    _destroy() {
        this._popModal();
        this._windows = [];
        this._thumbnails = [];
        this._windowList.destroy_all_children();
        this.visible = false;
    }

    destroy() {
        this._popModal();
        Main.layoutManager.disconnectObject(this);
        super.destroy();
    }
});

/**
 * TaskSwitcherItem - Individual window thumbnail (Windows 11 style)
 */
const TaskSwitcherItem = GObject.registerClass({
    GTypeName: 'WinbarTaskSwitcherItem',
}, class TaskSwitcherItem extends St.Button {
    _init(window, settings, thumbnailWidth, thumbnailHeight) {
        super._init({
            style_class: 'winbar-task-switcher-item',
            can_focus: true,
            reactive: true,
            track_hover: true,
        });

        this._window = window;
        this._settings = settings;
        this._thumbnailWidth = thumbnailWidth;
        this._thumbnailHeight = thumbnailHeight;

        this._buildUI();
    }

    _buildUI() {
        const content = new St.BoxLayout({
            style_class: 'winbar-task-switcher-item-content',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.set_child(content);

        // Header with app icon and title (Windows 11 style - at top)
        const header = new St.BoxLayout({
            style_class: 'winbar-task-switcher-header',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        content.add_child(header);

        // App icon
        const app = Shell.WindowTracker.get_default().get_window_app(this._window);
        if (app) {
            const icon = app.create_icon_texture(20);
            icon.set_style_class_name('winbar-task-switcher-icon');
            header.add_child(icon);
        }

        // Window title in header
        const title = new St.Label({
            style_class: 'winbar-task-switcher-item-title',
            text: this._window.get_title() || '',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        title.clutter_text.set_ellipsize(3); // PANGO_ELLIPSIZE_END
        header.add_child(title);

        // Thumbnail container
        const thumbContainer = new St.Widget({
            style_class: 'winbar-task-switcher-thumbnail',
            width: this._thumbnailWidth,
            height: this._thumbnailHeight,
        });
        content.add_child(thumbContainer);

        // Create window clone/thumbnail
        this._createThumbnail(thumbContainer);

        // Close button (overlaid on thumbnail)
        this._closeButton = new St.Button({
            style_class: 'winbar-task-switcher-close',
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 14,
            }),
        });
        thumbContainer.add_child(this._closeButton);
        this._closeButton.set_position(this._thumbnailWidth - 24, 4);
        this._closeButton.connect('clicked', () => {
            this._window.delete(global.get_current_time());
        });
    }

    _createThumbnail(container) {
        const actor = this._window.get_compositor_private();
        if (!actor) return;

        // Create a clone of the window
        const clone = new Clutter.Clone({
            source: actor,
            reactive: false,
        });

        // Scale to fit the dynamic thumbnail size
        const [windowWidth, windowHeight] = actor.get_size();
        const scale = Math.min(
            this._thumbnailWidth / windowWidth,
            this._thumbnailHeight / windowHeight,
            1.0
        );

        clone.set_size(windowWidth * scale, windowHeight * scale);
        clone.set_position(
            (this._thumbnailWidth - windowWidth * scale) / 2,
            (this._thumbnailHeight - windowHeight * scale) / 2
        );

        container.add_child(clone);
    }
});
