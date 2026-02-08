
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Mtk from 'gi://Mtk';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ICON_SIZE } from '../constants.js';
import { WindowPreviewMenu } from './windowPreview.js';

/**
 * TaskbarButton - Individual app button in the taskbar
 */
export const TaskbarButton = GObject.registerClass({
    GTypeName: 'WinbarTaskbarButton',
},
    class TaskbarButton extends St.Button {
        _init(app, extension, winbar) {
            super._init({
                style_class: 'winbar-taskbar-button',
                reactive: true,
                can_focus: true,
                track_hover: true,
                button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            });

            this._app = app;
            this._extension = extension;
            this._winbar = winbar;
            this._windows = [];
            this._previewTimeout = null;
            this._previewMenu = null;
            this._isTaskbarButton = true;
            this._delegate = this;
            this._isDestroyed = false;

            // Create button content
            this._box = new St.BoxLayout({
                style_class: 'winbar-button-box',
                vertical: true,
            });
            this.set_child(this._box);

            // App icon
            this._icon = this._app.create_icon_texture(ICON_SIZE);
            this._box.add_child(this._icon);

            // Indicator container (holds segments for multi-window indication)
            this._indicatorBox = new St.BoxLayout({
                style_class: 'winbar-indicator-box',
                x_align: Clutter.ActorAlign.CENTER,
            });

            // Primary running indicator
            this._indicator = new St.Widget({
                style_class: 'winbar-running-indicator',
            });

            // Secondary indicator (visible when multiple windows are open)
            this._indicator2 = new St.Widget({
                style_class: 'winbar-running-indicator',
            });

            this._indicatorBox.add_child(this._indicator);
            this._indicatorBox.add_child(this._indicator2);
            this._updateIndicatorPosition();
            this._box.add_child(this._indicatorBox);

            // Create tooltip
            this._tooltip = new St.Label({
                style_class: 'winbar-tooltip',
                text: this._app.get_name(),
                visible: false,
            });
            Main.layoutManager.addChrome(this._tooltip);
            this._tooltip.connect('destroy', () => { this._tooltip = null; });
            this._tooltipTimeout = null;

            // Connect signals
            this.connect('button-press-event', this._onButtonPress.bind(this));
            this.connect('clicked', this._onClicked.bind(this));
            this.connect('scroll-event', this._onScroll.bind(this));
            this.connect('enter-event', this._onEnter.bind(this));
            this.connect('leave-event', this._onLeave.bind(this));
            this.connect('destroy', this._onDestroy.bind(this));

            // Setup drag and drop
            this._draggable = DND.makeDraggable(this);
            this._draggable.connect('drag-begin', this._onDragBegin.bind(this));
            this._draggable.connect('drag-end', this._onDragEnd.bind(this));

            // Right-click menu
            this._setupContextMenu();

            // Update icon geometry when button is mapped/repositioned
            this.connect('notify::allocation', () => this._updateIconGeometry());

            this._updateState();
        }

        /**
         * Update the icon geometry for all windows of this app
         * This tells GNOME Shell where to animate minimize/close to
         */
        _updateIconGeometry() {
            if (this._isDestroyed || !this.get_stage()) return;

            // Defer to idle to ensure layout is complete
            if (this._updateIconIdleId) return;

            this._updateIconIdleId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
                this._updateIconIdleId = 0;

                if (this._isDestroyed || !this.get_stage()) return GLib.SOURCE_REMOVE;

                try {
                    const rect = new Mtk.Rectangle();
                    [rect.x, rect.y] = this.get_transformed_position();
                    [rect.width, rect.height] = this.get_transformed_size();

                    // Get the monitor index for this taskbar
                    const taskbarMonitor = this._winbar?._monitor;
                    const monitorIndex = taskbarMonitor ? taskbarMonitor.index : Main.layoutManager.primaryIndex;

                    const windows = this._app.get_windows();
                    windows.forEach(window => {
                        try {
                            // Only set geometry for windows on the same monitor
                            if (window.get_monitor() === monitorIndex) {
                                window.set_icon_geometry(rect);
                            }
                        } catch (e) {
                            // Window may be in invalid state
                        }
                    });
                } catch (e) {
                    // Ignore errors
                }

                return GLib.SOURCE_REMOVE;
            });
        }

        _setupContextMenu() {
            this._contextMenu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
            Main.uiGroup.add_child(this._contextMenu.actor);
            this._contextMenu.actor.connect('destroy', () => { this._contextMenu = null; });
            this._contextMenu.actor.hide();

            // Close menu when clicking outside
            this._menuCapturedEventId = null;
            this._contextMenu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    // Add global event capture to detect clicks outside
                    this._menuCapturedEventId = global.stage.connect('captured-event', (actor, event) => {
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
                    if (this._menuCapturedEventId) {
                        global.stage.disconnect(this._menuCapturedEventId);
                        this._menuCapturedEventId = null;
                    }
                }
            });

            // Pin/Unpin from taskbar option
            const isPinned = AppFavorites.getAppFavorites().isFavorite(this._app.get_id());
            const pinItem = new PopupMenu.PopupMenuItem(
                isPinned ? _('Unpin from taskbar') : _('Pin to taskbar')
            );
            pinItem.connect('activate', () => {
                if (isPinned)
                    AppFavorites.getAppFavorites().removeFavorite(this._app.get_id());
                else
                    AppFavorites.getAppFavorites().addFavorite(this._app.get_id());
            });
            this._contextMenu.addMenuItem(pinItem);

            // Pin/Unpin from Start Menu option
            const settings = this._extension.getSettings();
            this._pinStartItem = new PopupMenu.PopupMenuItem(_('Pin to Start'));
            this._pinStartItem.connect('activate', () => {
                const currentPinned = settings.get_strv('start-menu-pinned-apps');
                const appId = this._app.get_id();
                const isPinned = currentPinned.includes(appId);
                if (isPinned) {
                    const newPinned = currentPinned.filter(id => id !== appId);
                    settings.set_strv('start-menu-pinned-apps', newPinned);
                } else {
                    currentPinned.push(appId);
                    settings.set_strv('start-menu-pinned-apps', currentPinned);
                }
            });
            this._contextMenu.addMenuItem(this._pinStartItem);

            // Update pin start item text when menu opens
            this._contextMenu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen && this._pinStartItem) {
                    const currentPinned = settings.get_strv('start-menu-pinned-apps');
                    const isPinned = currentPinned.includes(this._app.get_id());
                    this._pinStartItem.label.text = isPinned ? _('Unpin from Start') : _('Pin to Start');
                }
            });

            this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // New window
            const newWindowItem = new PopupMenu.PopupMenuItem(_('New window'));
            newWindowItem.connect('activate', () => {
                this._app.open_new_window(-1);
            });
            this._contextMenu.addMenuItem(newWindowItem);

            // Close window(s)
            this._closeItem = new PopupMenu.PopupMenuItem(_('Close window'));
            this._closeItem.connect('activate', () => {
                this._app.get_windows().forEach(w => w.delete(global.get_current_time()));
            });
            this._contextMenu.addMenuItem(this._closeItem);

            // Update close item text when menu opens
            this._contextMenu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    const windowCount = this._app.get_windows().length;
                    this._closeItem.label.text = windowCount > 1
                        ? _('Close all windows')
                        : _('Close window');
                }
            });
        }

        _onButtonPress(_actor, event) {
            const button = event.get_button();

            if (button === 3) {
                // Right click - show context menu
                this._contextMenu.toggle();
                return Clutter.EVENT_STOP;
            }

            if (button === 2) {
                // Middle click
                this._handleMiddleClick();
                return Clutter.EVENT_STOP;
            }

            // Let left click propagate to trigger clicked signal
            return Clutter.EVENT_PROPAGATE;
        }

        _onClicked() {
            // Left click - handle normally
            this._handleLeftClick();
        }

        _handleMiddleClick() {
            const settings = this._extension.getSettings();
            const action = settings.get_string('middle-click-action');

            switch (action) {
                case 'close-window':
                    const windows = this._app.get_windows();
                    if (windows.length > 0) {
                        windows[0].delete(global.get_current_time());
                    }
                    break;
                case 'minimize':
                    const wins = this._app.get_windows();
                    wins.forEach(w => w.minimize());
                    break;
                case 'new-window':
                default:
                    this._app.open_new_window(-1);
                    break;
            }
        }

        _handleLeftClick() {
            const settings = this._extension.getSettings();
            const behavior = settings.get_enum('click-behavior');
            const windows = this._app.get_windows();

            if (windows.length === 0) {
                this._app.activate();
                return;
            }

            switch (behavior) {
                case 0: // smart
                    if (windows.length === 1) {
                        const win = windows[0];
                        if (win.has_focus()) {
                            win.minimize();
                        } else {
                            win.activate(global.get_current_time());
                        }
                    } else {
                        this._showWindowPreview();
                    }
                    break;

                case 1: // raise
                    windows[0].activate(global.get_current_time());
                    break;

                case 2: // preview
                    this._showWindowPreview();
                    break;

                case 3: // cycle
                    this._cycleWindows();
                    break;
            }
        }

        _cycleWindows() {
            const windows = this._app.get_windows();
            if (windows.length === 0) return;

            // Find currently focused window
            const focusedWindow = global.display.get_focus_window();
            let currentIndex = windows.indexOf(focusedWindow);

            // If no window is focused or current is last, go to first
            if (currentIndex === -1 || currentIndex === windows.length - 1) {
                windows[0].activate(global.get_current_time());
            } else {
                windows[currentIndex + 1].activate(global.get_current_time());
            }
        }

        _onScroll(_actor, event) {
            const settings = this._extension.getSettings();
            const action = settings.get_string('scroll-action');
            const direction = event.get_scroll_direction();

            if (direction !== Clutter.ScrollDirection.UP &&
                direction !== Clutter.ScrollDirection.DOWN) {
                return Clutter.EVENT_PROPAGATE;
            }

            switch (action) {
                case 'cycle-windows':
                    if (direction === Clutter.ScrollDirection.UP) {
                        this._cycleWindowsReverse();
                    } else {
                        this._cycleWindows();
                    }
                    break;
                case 'launch':
                    this._app.activate();
                    break;
                case 'none':
                default:
                    return Clutter.EVENT_PROPAGATE;
            }

            return Clutter.EVENT_STOP;
        }

        _cycleWindowsReverse() {
            const windows = this._app.get_windows();
            if (windows.length === 0) return;

            // Find currently focused window
            const focusedWindow = global.display.get_focus_window();
            let currentIndex = windows.indexOf(focusedWindow);

            // If no window is focused or current is first, go to last
            if (currentIndex <= 0) {
                windows[windows.length - 1].activate(global.get_current_time());
            } else {
                windows[currentIndex - 1].activate(global.get_current_time());
            }
        }

        _onEnter() {
            this.add_style_class_name('hover');

            // Show preview after delay if enabled
            const settings = this._extension.getSettings();
            const showPreviews = settings.get_boolean('show-window-previews');
            const windows = this._app.get_windows();

            // Show tooltip if no windows or previews disabled
            if (!showPreviews || windows.length === 0) {
                this._showTooltip();
            }

            if (!showPreviews)
                return;

            if (windows.length === 0)
                return;

            if (this._previewTimeout)
                GLib.source_remove(this._previewTimeout);

            const delay = settings.get_int('preview-hover-delay');
            this._previewTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._hideTooltip(); // Hide tooltip when showing preview
                this._showWindowPreview();
                this._previewTimeout = null;
                return GLib.SOURCE_REMOVE;
            });
        }

        _onLeave() {
            this.remove_style_class_name('hover');

            // Hide tooltip
            this._hideTooltip();

            if (this._previewTimeout) {
                GLib.source_remove(this._previewTimeout);
                this._previewTimeout = null;
            }

            // Close preview after a short delay, allowing time to move cursor to preview
            if (this._previewMenu) {
                this._previewMenu.scheduleClose();
            }
        }

        _showTooltip() {
            if (this._tooltipTimeout) {
                GLib.source_remove(this._tooltipTimeout);
            }

            this._tooltipTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._tooltipTimeout = null;

                if (!this._tooltip || !this.get_stage())
                    return GLib.SOURCE_REMOVE;

                // Position tooltip above the button
                const [buttonX, buttonY] = this.get_transformed_position();
                const [buttonWidth, buttonHeight] = this.get_size();
                const [tooltipWidth, tooltipHeight] = this._tooltip.get_preferred_size();

                // Get actual tooltip dimensions
                const natWidth = tooltipWidth[1] || 100;
                const natHeight = tooltipHeight[1] || 24;

                // Center tooltip above button
                let x = buttonX + (buttonWidth / 2) - (natWidth / 2);
                let y = buttonY - natHeight - 8;

                // Keep within screen bounds
                const monitor = Main.layoutManager.primaryMonitor;
                if (x < monitor.x + 5) x = monitor.x + 5;
                if (x + natWidth > monitor.x + monitor.width - 5)
                    x = monitor.x + monitor.width - natWidth - 5;
                if (y < monitor.y + 5) y = buttonY + buttonHeight + 8; // Show below if no room above

                this._tooltip.set_position(Math.round(x), Math.round(y));
                this._tooltip.show();
                this._tooltip.ease({
                    opacity: 255,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });

                return GLib.SOURCE_REMOVE;
            });
        }

        _hideTooltip() {
            if (this._tooltipTimeout) {
                GLib.source_remove(this._tooltipTimeout);
                this._tooltipTimeout = null;
            }

            if (this._tooltip) {
                this._tooltip.hide();
                this._tooltip.opacity = 0;
            }
        }

        _showWindowPreview() {
            const windows = this._app.get_windows();
            if (windows.length === 0)
                return;

            // Sort windows by stable_sequence to maintain consistent order
            const sortedWindows = windows.sort((a, b) => {
                return a.get_stable_sequence() - b.get_stable_sequence();
            });

            // Create preview popup
            if (this._previewMenu) {
                this._previewMenu.destroy();
                this._previewMenu = null;
            }

            const monitor = this._winbar ? this._winbar._monitor : Main.layoutManager.primaryMonitor;
            this._previewMenu = new WindowPreviewMenu(this, sortedWindows, this._extension.getSettings(), monitor);
            
            // WindowPreviewMenu extends St.Widget directly, not PopupMenu
            if (this._previewMenu) {
                this._previewMenu.connect('destroy', () => { this._previewMenu = null; });
                this._previewMenu.open();
            }
        }

        _onDragBegin() {
            this.add_style_class_name('dragging');
            const container = this.get_parent();
            if (container && container._delegate) {
                container._delegate._isReorderingApps = true;
            }
        }

        _onDragEnd() {
            this.remove_style_class_name('dragging');
            const container = this.get_parent();
            if (container && container._delegate) {
                container._delegate._isReorderingApps = false;
                if (container._delegate._persistFavoritesOrder) {
                    container._delegate._persistFavoritesOrder();
                }
            }
        }

        _updateIndicatorPosition() {
            // Guard against disposed objects
            if (this._isDestroyed || !this._indicator || !this._indicator2 || !this._extension) return;

            try {
                const settings = this._extension.getSettings();
                const position = settings.get_string('indicator-position');

                // Remove old position classes from both indicators
                for (const ind of [this._indicator, this._indicator2]) {
                    ind.remove_style_class_name('indicator-top');
                    ind.remove_style_class_name('indicator-bottom');
                    ind.remove_style_class_name('indicator-left');
                    ind.remove_style_class_name('indicator-right');
                }

                // Set alignment and orientation on the container
                switch (position) {
                    case 'top':
                        this._indicatorBox.y_align = Clutter.ActorAlign.START;
                        this._indicatorBox.x_align = Clutter.ActorAlign.CENTER;
                        this._indicatorBox.orientation = Clutter.Orientation.HORIZONTAL;
                        this._indicator.add_style_class_name('indicator-top');
                        this._indicator2.add_style_class_name('indicator-top');
                        break;
                    case 'left':
                        this._indicatorBox.y_align = Clutter.ActorAlign.CENTER;
                        this._indicatorBox.x_align = Clutter.ActorAlign.START;
                        this._indicatorBox.orientation = Clutter.Orientation.VERTICAL;
                        this._indicator.add_style_class_name('indicator-left');
                        this._indicator2.add_style_class_name('indicator-left');
                        break;
                    case 'right':
                        this._indicatorBox.y_align = Clutter.ActorAlign.CENTER;
                        this._indicatorBox.x_align = Clutter.ActorAlign.END;
                        this._indicatorBox.orientation = Clutter.Orientation.VERTICAL;
                        this._indicator.add_style_class_name('indicator-right');
                        this._indicator2.add_style_class_name('indicator-right');
                        break;
                    case 'bottom':
                    default:
                        this._indicatorBox.y_align = Clutter.ActorAlign.END;
                        this._indicatorBox.x_align = Clutter.ActorAlign.CENTER;
                        this._indicatorBox.orientation = Clutter.Orientation.HORIZONTAL;
                        this._indicator.add_style_class_name('indicator-bottom');
                        this._indicator2.add_style_class_name('indicator-bottom');
                        break;
                }
            } catch (e) {
                // Widget may have been disposed
            }
        }

        _updateIndicatorStyle() {
            // Guard against disposed objects
            if (this._isDestroyed || !this._indicator || !this._indicator2 || !this._extension) return;

            try {
                const settings = this._extension.getSettings();
                const style = settings.get_string('running-indicator-style');

                // Apply style class to both indicators
                for (const ind of [this._indicator, this._indicator2]) {
                    ind.remove_style_class_name('indicator-dot');
                    ind.remove_style_class_name('indicator-line');
                    ind.remove_style_class_name('indicator-dash');

                    switch (style) {
                        case 'line':
                            ind.add_style_class_name('indicator-line');
                            break;
                        case 'dash':
                            ind.add_style_class_name('indicator-dash');
                            break;
                        case 'dot':
                        default:
                            ind.add_style_class_name('indicator-dot');
                            break;
                    }
                }
            } catch (e) {
                // Widget may have been disposed
            }
        }

        _updateState() {
            // Guard against disposed objects
            if (this._isDestroyed || !this._indicator || !this._indicator2 || !this._app) return;

            try {
                this._windows = this._app.get_windows();
                const isRunning = this._windows.length > 0;
                const isMultiWindow = this._windows.length > 1;

                // Update icon geometry for minimize/close animations
                this._updateIconGeometry();

                if (isRunning) {
                    this._indicator.add_style_class_name('running');
                    this.add_style_class_name('running');
                } else {
                    this._indicator.remove_style_class_name('running');
                    this.remove_style_class_name('running');
                }

                // Check if focused
                const focusedWindow = global.display.get_focus_window();
                const isFocused = focusedWindow && this._windows.includes(focusedWindow);
                if (isFocused) {
                    this._indicator.add_style_class_name('focused');
                    this.add_style_class_name('focused');
                } else {
                    this._indicator.remove_style_class_name('focused');
                    this.remove_style_class_name('focused');
                }

                // Multi-window indicator (Windows 11-style segmented indicator)
                if (isMultiWindow) {
                    this._indicatorBox.add_style_class_name('multi-window');
                    this._indicator.add_style_class_name('multi-window');
                    this._indicator2.add_style_class_name('multi-window');
                    // Mirror running/focused state to secondary indicator
                    if (isRunning) this._indicator2.add_style_class_name('running');
                    if (isFocused) {
                        this._indicator2.add_style_class_name('focused');
                    } else {
                        this._indicator2.remove_style_class_name('focused');
                    }
                } else {
                    this._indicatorBox.remove_style_class_name('multi-window');
                    this._indicator.remove_style_class_name('multi-window');
                    this._indicator2.remove_style_class_name('multi-window');
                    this._indicator2.remove_style_class_name('running');
                    this._indicator2.remove_style_class_name('focused');
                }

                // Update indicator style
                this._updateIndicatorStyle();
            } catch (e) {
                // Widget may have been disposed
            }
        }

        getDragActor() {
            return this._app.create_icon_texture(ICON_SIZE);
        }

        getDragActorSource() {
            return this._icon;
        }

        // Return the app for drag operations
        getApp() {
            return this._app;
        }

        acceptDrop(source, actor, x, y) {
            if (!(source instanceof TaskbarButton) || source === this) {
                return false;
            }

            const container = this.get_parent();
            if (container && container._delegate && container._delegate._persistFavoritesOrder) {
                container._delegate._persistFavoritesOrder();
            }

            return true;
        }

        handleDragOver(source, actor, x, y) {
            if (!(source instanceof TaskbarButton) || source === this) {
                return DND.DragMotionResult.NO_DROP;
            }

            const container = this.get_parent();
            if (!container) {
                return DND.DragMotionResult.NO_DROP;
            }

            const children = container.get_children();
            const myIndex = children.indexOf(this);
            const sourceIndex = children.indexOf(source);

            if (myIndex === -1 || sourceIndex === -1) {
                return DND.DragMotionResult.NO_DROP;
            }

            const myWidth = this.get_width();
            const insertBefore = (x < myWidth / 2);

            let targetIndex = insertBefore ? myIndex : myIndex + 1;

            if (sourceIndex < targetIndex) {
                targetIndex--;
            }

            if (sourceIndex !== targetIndex) {
                container.set_child_at_index(source, targetIndex);
            }

            return DND.DragMotionResult.MOVE_DROP;
        }

        _onDestroy() {
            // Mark as destroyed to prevent callbacks on disposed objects
            this._isDestroyed = true;

            // Disconnect global signals FIRST to prevent input blocking
            if (this._menuCapturedEventId) {
                try {
                    global.stage.disconnect(this._menuCapturedEventId);
                } catch (e) { console.error(e); }
                this._menuCapturedEventId = null;
            }

            // Clear timeouts
            if (this._updateIconIdleId) {
                GLib.source_remove(this._updateIconIdleId);
                this._updateIconIdleId = 0;
            }
            if (this._previewTimeout) {
                GLib.source_remove(this._previewTimeout);
                this._previewTimeout = null;
            }
            if (this._tooltipTimeout) {
                GLib.source_remove(this._tooltipTimeout);
                this._tooltipTimeout = null;
            }

            // Destroy UI elements safely
            if (this._tooltip) {
                const tooltip = this._tooltip;
                this._tooltip = null;
                try {
                    tooltip.destroy();
                } catch (e) {
                    // Ignore already disposed errors 
                }
            }

            if (this._previewMenu) {
                const menu = this._previewMenu;
                this._previewMenu = null;
                try {
                    menu.destroy();
                } catch (e) {
                    // Ignore already disposed errors
                }
            }

            if (this._contextMenu) {
                const menu = this._contextMenu;
                this._contextMenu = null;
                try {
                    menu.destroy();
                } catch (e) {
                    // Ignore already disposed errors
                }
            }
        }
    });

/**
 * WindowButton - Button for orphan windows (Wine/Lutris apps without proper .desktop files)
 * These windows return null from Shell.WindowTracker.get_window_app()
 * Supports multiple windows grouped by wmClass
 */
export const WindowButton = GObject.registerClass({
    GTypeName: 'WinbarWindowButton',
},
    class WindowButton extends St.Button {
        _init(window, extension, winbar) {
            super._init({
                style_class: 'winbar-taskbar-button',
                reactive: true,
                can_focus: true,
                track_hover: true,
                button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            });

            this._window = window;  // Primary window (for icon)
            this._windows = [window];  // All windows for this wmClass
            this._extension = extension;
            this._winbar = winbar;
            this._isWindowButton = true;
            this._delegate = this;
            this._isDestroyed = false;
            this._wmClass = window.get_wm_class() || 'unknown';
            this._windowSignals = new Map();  // Track signals per window

            // Create button content
            this._box = new St.BoxLayout({
                style_class: 'winbar-button-box',
                vertical: true,
            });
            this.set_child(this._box);

            // Create icon from window
            this._icon = this._createWindowIcon();
            this._box.add_child(this._icon);

            // Indicator container (holds segments for multi-window indication)
            this._indicatorBox = new St.BoxLayout({
                style_class: 'winbar-indicator-box',
                x_align: Clutter.ActorAlign.CENTER,
            });

            // Primary running indicator (always shown for window buttons)
            this._indicator = new St.Widget({
                style_class: 'winbar-running-indicator running',
            });

            // Secondary indicator (visible when multiple windows are open)
            this._indicator2 = new St.Widget({
                style_class: 'winbar-running-indicator',
            });

            this._indicatorBox.add_child(this._indicator);
            this._indicatorBox.add_child(this._indicator2);
            // _updateIndicatorPosition handles adding indicatorBox to _box
            this._updateIndicatorPosition();

            // Create tooltip
            this._tooltip = new St.Label({
                style_class: 'winbar-tooltip',
                text: this._getWindowTitle(),
                visible: false,
            });
            Main.layoutManager.addChrome(this._tooltip);
            this._tooltip.connect('destroy', () => { this._tooltip = null; });
            this._tooltipTimeout = null;

            // Connect signals
            this.connect('button-press-event', this._onButtonPress.bind(this));
            this.connect('clicked', this._onClicked.bind(this));
            this.connect('enter-event', this._onEnter.bind(this));
            this.connect('leave-event', this._onLeave.bind(this));
            this.connect('destroy', this._onDestroy.bind(this));

            // Track window title changes for primary window
            this._connectWindowSignals(window);

            // Right-click menu
            this._setupContextMenu();

            // Update icon geometry when button is mapped/repositioned
            this.connect('notify::allocation', () => this._updateIconGeometry());

            this._updateState();
        }

        /**
         * Update the icon geometry for all windows of this button
         * This tells GNOME Shell where to animate minimize/close to
         */
        _updateIconGeometry() {
            if (this._isDestroyed || !this.get_stage()) return;

            // Defer to idle to ensure layout is complete
            if (this._updateIconIdleId) return;

            this._updateIconIdleId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
                this._updateIconIdleId = 0;

                if (this._isDestroyed || !this.get_stage()) return GLib.SOURCE_REMOVE;

                try {
                    const rect = new Mtk.Rectangle();
                    [rect.x, rect.y] = this.get_transformed_position();
                    [rect.width, rect.height] = this.get_transformed_size();

                    // Get the monitor index for this taskbar
                    const taskbarMonitor = this._winbar?._monitor;
                    const monitorIndex = taskbarMonitor ? taskbarMonitor.index : Main.layoutManager.primaryIndex;

                    this._windows.forEach(window => {
                        try {
                            // Only set geometry for windows on the same monitor
                            if (window.get_monitor() === monitorIndex) {
                                window.set_icon_geometry(rect);
                            }
                        } catch (e) {
                            // Window may be in invalid state
                        }
                    });
                } catch (e) {
                    // Ignore errors
                }

                return GLib.SOURCE_REMOVE;
            });
        }
        
        _connectWindowSignals(window) {
            const signalId = window.connect('notify::title', () => {
                if (this._tooltip && window === this._window) {
                    this._tooltip.text = this._getWindowTitle();
                }
            });
            this._windowSignals.set(window, signalId);
        }
        
        _disconnectWindowSignals(window) {
            const signalId = this._windowSignals.get(window);
            if (signalId) {
                try { window.disconnect(signalId); } catch (e) { /* Signal may already be disconnected */ }
                this._windowSignals.delete(window);
            }
        }
        
        addWindow(window) {
            // Add a new window to this button's group
            if (this._windows.includes(window)) return;
            
            this._windows.push(window);
            this._connectWindowSignals(window);
            this._updateState();
        }
        
        removeWindow(window) {
            // Remove a window from this button's group
            const index = this._windows.indexOf(window);
            if (index === -1) return;
            
            this._disconnectWindowSignals(window);
            this._windows.splice(index, 1);
            
            // If this was the primary window, update to next available
            if (window === this._window && this._windows.length > 0) {
                this._window = this._windows[0];
                if (this._tooltip) {
                    this._tooltip.text = this._getWindowTitle();
                }
            }
            
            this._updateState();
            
            // Return true if button should be destroyed (no windows left)
            return this._windows.length === 0;
        }
        
        getWindows() {
            return this._windows;
        }
        
        getWmClass() {
            return this._wmClass;
        }

        _createWindowIcon() {
            // Try to get icon from window's WM_CLASS or use a fallback
            const start_texture_cache = St.TextureCache.get_default();
            let icon = null;

            try {
                // Try to load from window's mini icon
                const mutterWindow = this._window.get_compositor_private();
                if (mutterWindow) {
                    icon = start_texture_cache.bind_cairo_surface_property(
                        mutterWindow.meta_window,
                        'icon'
                    );
                }
            } catch (e) {
                // Ignore errors
            }

            // Fallback to generic application icon
            if (!icon) {
                icon = new St.Icon({
                    icon_name: 'application-x-executable',
                    icon_size: ICON_SIZE,
                    style_class: 'winbar-app-icon',
                });
            } else {
                icon.set_size(ICON_SIZE, ICON_SIZE);
            }

            return icon;
        }

        _getWindowTitle() {
            return this._window.get_title() || _('Unknown Window');
        }

        _updateIndicatorPosition() {
            if (this._isDestroyed || !this._indicator || !this._indicator2 || !this._extension) return;

            try {
                const settings = this._extension.getSettings();
                const position = settings.get_string('indicator-position');
                const style = settings.get_string('running-indicator-style');

                // Remove from current parent if needed
                if (this._indicatorBox.get_parent()) {
                    this._indicatorBox.get_parent().remove_child(this._indicatorBox);
                }

                if (position === 'top') {
                    this._box.insert_child_at_index(this._indicatorBox, 0);
                } else {
                    this._box.add_child(this._indicatorBox);
                }

                // Apply position classes to both indicators
                for (const ind of [this._indicator, this._indicator2]) {
                    ind.remove_style_class_name('indicator-top');
                    ind.remove_style_class_name('indicator-bottom');
                    ind.remove_style_class_name('indicator-left');
                    ind.remove_style_class_name('indicator-right');
                    ind.remove_style_class_name('indicator-dot');
                    ind.remove_style_class_name('indicator-line');
                    ind.remove_style_class_name('indicator-dash');

                    // Add position class
                    switch (position) {
                        case 'top':
                            ind.add_style_class_name('indicator-top');
                            break;
                        case 'left':
                            ind.add_style_class_name('indicator-left');
                            break;
                        case 'right':
                            ind.add_style_class_name('indicator-right');
                            break;
                        case 'bottom':
                        default:
                            ind.add_style_class_name('indicator-bottom');
                            break;
                    }

                    // Add style class
                    switch (style) {
                        case 'line':
                            ind.add_style_class_name('indicator-line');
                            break;
                        case 'dash':
                            ind.add_style_class_name('indicator-dash');
                            break;
                        case 'dot':
                        default:
                            ind.add_style_class_name('indicator-dot');
                            break;
                    }
                }

                // Set box orientation based on position
                switch (position) {
                    case 'left':
                    case 'right':
                        this._indicatorBox.orientation = Clutter.Orientation.VERTICAL;
                        break;
                    default:
                        this._indicatorBox.orientation = Clutter.Orientation.HORIZONTAL;
                        break;
                }
            } catch (e) {
                // Widget may have been disposed
            }
        }

        _updateState() {
            if (this._isDestroyed || !this._indicator || !this._indicator2) return;

            // Update icon geometry for minimize/close animations
            this._updateIconGeometry();

            const isMultiWindow = this._windows.length > 1;

            // Check if any window in the group has focus
            const isFocused = this._windows.some(w => w.has_focus());
            if (isFocused) {
                this.add_style_class_name('focused');
                this._indicator.add_style_class_name('focused');
            } else {
                this.remove_style_class_name('focused');
                this._indicator.remove_style_class_name('focused');
            }

            // Multi-window indicator (Windows 11-style segmented indicator)
            if (isMultiWindow) {
                this._indicatorBox.add_style_class_name('multi-window');
                this._indicator.add_style_class_name('multi-window');
                this._indicator2.add_style_class_name('multi-window');
                this._indicator2.add_style_class_name('running');
                if (isFocused) {
                    this._indicator2.add_style_class_name('focused');
                } else {
                    this._indicator2.remove_style_class_name('focused');
                }
            } else {
                this._indicatorBox.remove_style_class_name('multi-window');
                this._indicator.remove_style_class_name('multi-window');
                this._indicator2.remove_style_class_name('multi-window');
                this._indicator2.remove_style_class_name('running');
                this._indicator2.remove_style_class_name('focused');
            }
        }

        _setupContextMenu() {
            this._contextMenu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
            Main.uiGroup.add_child(this._contextMenu.actor);
            this._contextMenu.actor.connect('destroy', () => { this._contextMenu = null; });
            this._contextMenu.actor.hide();

            // Close menu when clicking outside
            this._menuCapturedEventId = null;
            this._contextMenu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    this._menuCapturedEventId = global.stage.connect('captured-event', (actor, event) => {
                        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                            const [eventX, eventY] = event.get_coords();
                            const menuActor = this._contextMenu.actor;
                            const [menuX, menuY] = menuActor.get_transformed_position();
                            const [menuWidth, menuHeight] = menuActor.get_size();

                            if (eventX < menuX || eventX > menuX + menuWidth ||
                                eventY < menuY || eventY > menuY + menuHeight) {
                                this._contextMenu.close();
                                return Clutter.EVENT_STOP;
                            }
                        }
                        return Clutter.EVENT_PROPAGATE;
                    });
                } else {
                    if (this._menuCapturedEventId) {
                        global.stage.disconnect(this._menuCapturedEventId);
                        this._menuCapturedEventId = null;
                    }
                }
            });

            // Close window
            const closeItem = new PopupMenu.PopupMenuItem(_('Close window'));
            closeItem.connect('activate', () => {
                this._window.delete(global.get_current_time());
            });
            this._contextMenu.addMenuItem(closeItem);
        }

        _onButtonPress(_actor, event) {
            const button = event.get_button();

            if (button === 3) {
                this._contextMenu.toggle();
                return Clutter.EVENT_STOP;
            }

            if (button === 2) {
                // Middle click - close window
                this._window.delete(global.get_current_time());
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        _onClicked() {
            if (this._windows.length === 0) return;
            
            if (this._windows.length === 1) {
                // Single window - toggle focus/minimize
                if (this._window.has_focus()) {
                    this._window.minimize();
                } else {
                    this._window.activate(global.get_current_time());
                }
            } else {
                // Multiple windows - cycle through them or show preview
                const focusedWindow = this._windows.find(w => w.has_focus());
                if (focusedWindow) {
                    // Find next window and focus it
                    const currentIndex = this._windows.indexOf(focusedWindow);
                    const nextIndex = (currentIndex + 1) % this._windows.length;
                    this._windows[nextIndex].activate(global.get_current_time());
                } else {
                    // Focus the most recently used window
                    const sortedWindows = [...this._windows].sort((a, b) => 
                        b.get_user_time() - a.get_user_time()
                    );
                    sortedWindows[0].activate(global.get_current_time());
                }
            }
        }

        _onEnter() {
            this.add_style_class_name('hover');
            this._showTooltip();
        }

        _onLeave() {
            this.remove_style_class_name('hover');
            this._hideTooltip();
        }

        _showTooltip() {
            if (this._tooltipTimeout) {
                GLib.source_remove(this._tooltipTimeout);
            }

            this._tooltipTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                if (this._tooltip && !this._isDestroyed) {
                    const [x, y] = this.get_transformed_position();
                    const width = this.get_width();

                    this._tooltip.set_position(
                        x + width / 2 - this._tooltip.get_width() / 2,
                        y - this._tooltip.get_height() - 5
                    );
                    this._tooltip.show();
                }
                this._tooltipTimeout = null;
                return GLib.SOURCE_REMOVE;
            });
        }

        _hideTooltip() {
            if (this._tooltipTimeout) {
                GLib.source_remove(this._tooltipTimeout);
                this._tooltipTimeout = null;
            }
            if (this._tooltip) {
                this._tooltip.hide();
            }
        }

        getWindow() {
            return this._window;
        }

        _onDestroy() {
            this._isDestroyed = true;

            // Clear idle source
            if (this._updateIconIdleId) {
                GLib.source_remove(this._updateIconIdleId);
                this._updateIconIdleId = 0;
            }

            // Disconnect all window signals
            for (const [window, signalId] of this._windowSignals) {
                try { window.disconnect(signalId); } catch (e) { /* Signal may already be disconnected */ }
            }
            this._windowSignals.clear();
            this._windows = [];

            if (this._menuCapturedEventId) {
                try {
                    global.stage.disconnect(this._menuCapturedEventId);
                } catch (e) { /* Handler may already be disconnected */ }
                this._menuCapturedEventId = null;
            }

            if (this._tooltipTimeout) {
                GLib.source_remove(this._tooltipTimeout);
                this._tooltipTimeout = null;
            }

            if (this._tooltip) {
                try {
                    this._tooltip.destroy();
                } catch (e) { /* Actor may already be destroyed */ }
                this._tooltip = null;
            }

            if (this._contextMenu) {
                try {
                    this._contextMenu.destroy();
                } catch (e) { /* Actor may already be destroyed */ }
                this._contextMenu = null;
            }
        }
    });
