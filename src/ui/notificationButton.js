import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { getEffectiveThemeMode, addBlurEffect } from '../utils.js';
import { THEME_COLORS } from '../constants.js';

export const NotificationButton = GObject.registerClass({
    GTypeName: 'WinbarNotificationButton',
},
    class NotificationButton extends St.Button {
        _init(extension, winbar) {
            super._init({
                style_class: 'winbar-notification-button',
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            this._extension = extension;
            this._winbar = winbar;
            this._settings = extension.getSettings();
            this._count = 0;
            this._isOpen = false;
            this._notificationItems = new Map();
            this._sources = new Map();

            const box = new St.BoxLayout({
                style_class: 'winbar-notification-box',
            });
            this.set_child(box);

            this._icon = new St.Icon({
                icon_name: 'preferences-system-notifications-symbolic',
                icon_size: 16,
            });
            box.add_child(this._icon);

            this._badge = new St.Label({
                style_class: 'winbar-notification-badge',
                visible: false,
            });
            box.add_child(this._badge);

            // Create notification popup
            this._notificationPopup = new St.BoxLayout({
                vertical: true,
                style_class: 'winbar-notification-popup',
                reactive: true,
            });
            this._notificationPopup.hide();
            Main.layoutManager.addChrome(this._notificationPopup, { affectsStruts: false });

            // Add blur effect for modern frosted glass look
            addBlurEffect(this._notificationPopup);

            // Header
            const header = new St.BoxLayout({
                style_class: 'winbar-notification-header',
                x_expand: true,
            });
            this._notificationPopup.add_child(header);

            const headerLabel = new St.Label({
                text: _('Notifications'),
                style: 'font-weight: bold; font-size: 14px;',
                x_expand: true,
            });
            header.add_child(headerLabel);

            // Clear all button
            this._clearAllBtn = new St.Button({
                label: _('Clear all'),
                style_class: 'winbar-notification-clear-btn',
                style: 'font-size: 11px; padding: 4px 8px;',
            });
            this._clearAllBtn.connect('clicked', () => {
                this._clearAllNotifications();
            });
            header.add_child(this._clearAllBtn);

            // Scrollable container for notifications
            this._scrollView = new St.ScrollView({
                style_class: 'winbar-notification-scroll',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
                y_expand: true,
            });
            this._notificationPopup.add_child(this._scrollView);

            this._notificationList = new St.BoxLayout({
                vertical: true,
                style_class: 'winbar-notification-list',
                x_expand: true,
            });
            this._scrollView.set_child(this._notificationList);

            // Empty state label
            this._emptyLabel = new St.Label({
                text: _('No new notifications'),
                style_class: 'winbar-notification-empty',
                style: 'padding: 20px; color: #888888; text-align: center;',
            });
            this._notificationList.add_child(this._emptyLabel);

            this.connect('clicked', () => {
                // Check if user prefers native GNOME notifications
                if (this._settings.get_boolean('use-native-notifications')) {
                    this._openNativeNotifications();
                } else {
                    this._toggleNotification();
                }
            });

            // Watch for focus changes - close popup when another window gets focus
            this._notifFocusWindowId = global.display.connect('notify::focus-window', () => {
                const focusWindow = global.display.get_focus_window();
                if (focusWindow && this._isOpen) {
                    this._closeNotification();
                }
            });

            // Connect to GNOME's message tray to track notifications
            this._connectToMessageTray();
        }

        _connectToMessageTray() {
            // Connect directly to Main.messageTray to get notification sources
            if (!Main.messageTray) return;

            // Get existing sources and their notifications
            this._sources = new Map();
            
            this._sourceAddedId = Main.messageTray.connect('source-added', (tray, source) => {
                this._addSource(source);
            });
            
            this._sourceRemovedId = Main.messageTray.connect('source-removed', (tray, source) => {
                this._removeSource(source);
            });

            // Add existing sources
            Main.messageTray.getSources().forEach(source => {
                this._addSource(source);
            });
        }

        _addSource(source) {
            if (this._sources.has(source)) return;
            
            const sourceData = {
                notificationAddedId: source.connect('notification-added', (src, notification) => {
                    this._syncNotifications();
                }),
                notificationRemovedId: source.connect('notification-removed', (src, notification) => {
                    this._syncNotifications();
                }),
            };
            
            this._sources.set(source, sourceData);
            this._syncNotifications();
        }

        _removeSource(source) {
            const sourceData = this._sources.get(source);
            if (sourceData) {
                try {
                    source.disconnect(sourceData.notificationAddedId);
                    source.disconnect(sourceData.notificationRemovedId);
                } catch (e) { /* Signal may already be disconnected */ }
                this._sources.delete(source);
            }
            this._syncNotifications();
        }

        _syncNotifications() {
            // Clear existing items
            this._notificationItems.forEach((item, key) => {
                if (item.get_parent()) {
                    item.get_parent().remove_child(item);
                }
                item.destroy();
            });
            this._notificationItems.clear();

            // Get notifications from all sources in messageTray
            if (!Main.messageTray) {
                this._updateEmptyState();
                return;
            }

            let count = 0;
            const sources = Main.messageTray.getSources();
            
            sources.forEach(source => {
                // Each source has a notifications array
                if (source.notifications) {
                    source.notifications.forEach((notification, index) => {
                        const key = `${source.title || 'unknown'}-${index}-${notification.title || ''}`;
                        this._addNotificationItem(notification, source, key);
                        count++;
                    });
                }
            });

            this._updateBadge(count);
            this._updateEmptyState();
        }

        _addNotificationItem(notification, source, key) {
            const item = new St.BoxLayout({
                style_class: 'winbar-notification-item',
                vertical: true,
                x_expand: true,
                reactive: true,
                style: `
                    padding: 10px 12px;
                    margin: 4px 0;
                    border-radius: 8px;
                    background-color: rgba(255, 255, 255, 0.05);
                `,
            });

            // Header row with app name and close button
            const headerRow = new St.BoxLayout({
                x_expand: true,
            });
            item.add_child(headerRow);

            // Get notification info directly from the notification object
            const sourceName = source?.title || _('Application');
            const title = notification.title || '';
            const body = notification.body || notification.bannerBodyText || '';
            let datetime = '';
            
            if (notification.datetime) {
                datetime = this._formatTime(notification.datetime);
            }

            const sourceLabel = new St.Label({
                text: sourceName,
                style: 'font-size: 10px; color: #888888; font-weight: 500;',
                x_expand: true,
            });
            headerRow.add_child(sourceLabel);

            if (datetime) {
                const timeLabel = new St.Label({
                    text: datetime,
                    style: 'font-size: 10px; color: #666666;',
                });
                headerRow.add_child(timeLabel);
            }

            // Close button for this notification
            const closeBtn = new St.Button({
                style_class: 'winbar-notification-close',
                style: 'padding: 2px 6px; margin-left: 8px;',
            });
            closeBtn.set_child(new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 12,
            }));
            closeBtn.connect('clicked', () => {
                this._dismissNotification(notification, key);
            });
            headerRow.add_child(closeBtn);

            // Title
            if (title) {
                const titleLabel = new St.Label({
                    text: title,
                    style: 'font-size: 12px; font-weight: bold; margin-top: 4px;',
                    x_expand: true,
                });
                titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                item.add_child(titleLabel);
            }

            // Body
            if (body) {
                const bodyLabel = new St.Label({
                    text: body,
                    style: 'font-size: 11px; color: #cccccc; margin-top: 2px;',
                    x_expand: true,
                });
                bodyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                bodyLabel.clutter_text.line_wrap = true;
                bodyLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                item.add_child(bodyLabel);
            }

            // Click to activate
            item.connect('button-press-event', () => {
                try {
                    notification.activate();
                    this._closeNotification();
                } catch (e) {
                    // Ignore activation errors
                }
                return Clutter.EVENT_STOP;
            });

            // Hover effect
            item.connect('enter-event', () => {
                item.set_style(`
                    padding: 10px 12px;
                    margin: 4px 0;
                    border-radius: 8px;
                    background-color: rgba(255, 255, 255, 0.1);
                `);
            });
            item.connect('leave-event', () => {
                item.set_style(`
                    padding: 10px 12px;
                    margin: 4px 0;
                    border-radius: 8px;
                    background-color: rgba(255, 255, 255, 0.05);
                `);
            });

            this._notificationList.insert_child_at_index(item, 0);
            this._notificationItems.set(key, item);
        }

        _formatTime(datetime) {
            if (!datetime) return '';
            try {
                const now = GLib.DateTime.new_now_local();
                const diff = now.difference(datetime) / 1000000; // microseconds to seconds
                
                if (diff < 60) {
                    return _('Just now');
                } else if (diff < 3600) {
                    const mins = Math.floor(diff / 60);
                    return mins === 1 ? _('1 min ago') : _('%d mins ago').format(mins);
                } else if (diff < 86400) {
                    const hours = Math.floor(diff / 3600);
                    return hours === 1 ? _('1 hour ago') : _('%d hours ago').format(hours);
                } else {
                    return datetime.format('%H:%M');
                }
            } catch (e) {
                return '';
            }
        }

        _dismissNotification(notification, key) {
            try {
                // Remove from GNOME's notification system
                // Use MessageTray.NotificationDestroyedReason.DISMISSED
                if (notification.destroy) {
                    notification.destroy(1); // 1 = DISMISSED
                }
            } catch (e) {
                // Ignore errors
            }
            
            // Remove from our list
            const item = this._notificationItems.get(key);
            if (item) {
                if (item.get_parent()) {
                    item.get_parent().remove_child(item);
                }
                item.destroy();
                this._notificationItems.delete(key);
            }

            this._updateBadge(this._notificationItems.size);
            this._updateEmptyState();
        }

        _clearAllNotifications() {
            // Clear all notifications from all sources
            if (Main.messageTray) {
                const sources = Main.messageTray.getSources();
                sources.forEach(source => {
                    if (source.notifications) {
                        // Copy the array since we're modifying it
                        [...source.notifications].forEach(notification => {
                            try {
                                notification.destroy(1); // 1 = DISMISSED
                            } catch (e) { /* Actor may already be destroyed */ }
                        });
                    }
                });
            }

            // Clear our list
            this._notificationItems.forEach((item, key) => {
                if (item.get_parent()) {
                    item.get_parent().remove_child(item);
                }
                item.destroy();
            });
            this._notificationItems.clear();

            this._updateBadge(0);
            this._updateEmptyState();
        }

        _updateBadge(count) {
            this._count = count;
            if (count > 0) {
                this._badge.set_text(count > 99 ? '99+' : count.toString());
                this._badge.show();
            } else {
                this._badge.hide();
            }
        }

        _updateEmptyState() {
            const hasNotifications = this._notificationItems.size > 0;
            this._emptyLabel.visible = !hasNotifications;
            this._clearAllBtn.visible = hasNotifications;
        }

        _openNativeNotifications() {
            // Open GNOME's native date menu (which contains the notification center)
            const dateMenu = Main.panel.statusArea.dateMenu;
            if (dateMenu && dateMenu.menu) {
                if (!dateMenu.menu.isOpen) {
                    // Get Winbar's notification button position BEFORE opening menu
                    const [buttonX, buttonY] = this.get_transformed_position();
                    const [buttonWidth, buttonHeight] = this.get_size();
                    const monitor = this._winbar?._monitor || Main.layoutManager.primaryMonitor;
                    
                    // Configure the menu to open from the bottom (expand upward)
                    dateMenu.menu._arrowSide = St.Side.BOTTOM;
                    dateMenu.menu._arrowAlignment = 0.5;
                    
                    // Configure BoxPointer for proper positioning
                    if (dateMenu.menu._boxPointer) {
                        dateMenu.menu._boxPointer._userArrowSide = St.Side.BOTTOM;
                        // Store original source actor
                        if (!this._dateMenuOriginalSourceActor) {
                            this._dateMenuOriginalSourceActor = dateMenu.menu._boxPointer.sourceActor;
                        }
                        // Use this button as the source actor for positioning
                        dateMenu.menu._boxPointer.sourceActor = this;
                        dateMenu.menu._boxPointer._winbarInPanel = true;
                        dateMenu.menu._boxPointer._arrowSide = St.Side.BOTTOM;
                    }
                    
                    dateMenu.menu.open();
                    
                    // Function to reposition the menu with bottom-anchored positioning
                    const repositionMenu = () => {
                        const menuActor = dateMenu.menu.actor;
                        if (!menuActor) return false;
                        
                        // Get menu size
                        let [menuWidth, menuHeight] = menuActor.get_size();
                        
                        if (menuWidth === 0 || menuHeight === 0) {
                            [, , menuWidth, menuHeight] = menuActor.get_preferred_size();
                        }
                        
                        if (menuWidth === 0 || menuHeight === 0) {
                            const box = menuActor.get_first_child();
                            if (box) {
                                [menuWidth, menuHeight] = box.get_size();
                                if (menuWidth === 0 || menuHeight === 0) {
                                    [, , menuWidth, menuHeight] = box.get_preferred_size();
                                }
                            }
                        }
                        
                        if (menuWidth === 0 || menuHeight === 0) return false;
                        
                        // Position: bottom edge fixed above button, centered on button
                        let x = buttonX + (buttonWidth / 2) - (menuWidth / 2);
                        let y = buttonY - menuHeight - 8;
                        
                        // Keep within monitor bounds
                        if (x < monitor.x + 10)
                            x = monitor.x + 10;
                        if (x + menuWidth > monitor.x + monitor.width - 10)
                            x = monitor.x + monitor.width - menuWidth - 10;
                        if (y < monitor.y + 10)
                            y = monitor.y + 10;
                        
                        menuActor.set_position(Math.floor(x), Math.floor(y));
                        return true;
                    };
                    
                    // Try repositioning with increasing delays
                    const tryReposition = (delay, maxAttempts, attempt = 1) => {
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                            if (!dateMenu.menu.isOpen) return GLib.SOURCE_REMOVE;
                            
                            const success = repositionMenu();
                            if (!success && attempt < maxAttempts) {
                                tryReposition(delay * 2, maxAttempts, attempt + 1);
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    };
                    
                    tryReposition(50, 5);
                    
                    // Monitor for size changes
                    const boxPointer = dateMenu.menu._boxPointer;
                    
                    // Disconnect old handlers
                    if (this._dateMenuAllocationId) {
                        try { dateMenu.menu.actor.disconnect(this._dateMenuAllocationId); } catch(e) { /* Signal may already be disconnected */ }
                        this._dateMenuAllocationId = null;
                    }
                    if (this._dateMenuHeightId) {
                        try { boxPointer.disconnect(this._dateMenuHeightId); } catch(e) { /* Signal may already be disconnected */ }
                        this._dateMenuHeightId = null;
                    }
                    if (this._dateMenuBinHeightId && boxPointer.bin) {
                        try { boxPointer.bin.disconnect(this._dateMenuBinHeightId); } catch(e) { /* Signal may already be disconnected */ }
                        this._dateMenuBinHeightId = null;
                    }

                    // Monitor menu actor height
                    this._dateMenuAllocationId = dateMenu.menu.actor.connect('notify::height', () => {
                        if (dateMenu.menu.isOpen) repositionMenu();
                    });
                    
                    // Monitor BoxPointer height
                    this._dateMenuHeightId = boxPointer.connect('notify::height', () => {
                        if (dateMenu.menu.isOpen) repositionMenu();
                    });
                    
                    // Monitor bin height
                    if (boxPointer.bin) {
                        this._dateMenuBinHeightId = boxPointer.bin.connect('notify::height', () => {
                            if (dateMenu.menu.isOpen) repositionMenu();
                        });
                    }
                    
                    // Clean up when menu closes
                    const closeId = dateMenu.menu.connect('open-state-changed', (menu, isOpen) => {
                        if (!isOpen) {
                            // Disconnect height monitors
                            if (this._dateMenuAllocationId) {
                                try { dateMenu.menu.actor.disconnect(this._dateMenuAllocationId); } catch(e) { /* Signal may already be disconnected */ }
                                this._dateMenuAllocationId = null;
                            }
                            if (this._dateMenuHeightId) {
                                try { boxPointer.disconnect(this._dateMenuHeightId); } catch(e) { /* Signal may already be disconnected */ }
                                this._dateMenuHeightId = null;
                            }
                            if (this._dateMenuBinHeightId && boxPointer.bin) {
                                try { boxPointer.bin.disconnect(this._dateMenuBinHeightId); } catch(e) { /* Signal may already be disconnected */ }
                                this._dateMenuBinHeightId = null;
                            }
                            // Restore original BoxPointer settings
                            if (dateMenu.menu._boxPointer) {
                                if (this._dateMenuOriginalSourceActor) {
                                    dateMenu.menu._boxPointer.sourceActor = this._dateMenuOriginalSourceActor;
                                }
                                dateMenu.menu._boxPointer._userArrowSide = St.Side.TOP;
                                dateMenu.menu._boxPointer._arrowSide = St.Side.TOP;
                                dateMenu.menu._boxPointer._winbarInPanel = false;
                            }
                            dateMenu.menu._arrowSide = St.Side.TOP;
                            dateMenu.menu.disconnect(closeId);
                        }
                    });
                    
                } else {
                    dateMenu.menu.close();
                }
            }
        }

        _toggleNotification() {
            // Always use our custom popup which integrates with GNOME's notification system
            // The native GNOME dateMenu opens at the top panel which can't be repositioned
            
            if (this._isOpen) {
                this._closeNotification();
            } else {
                this._openNotification();
            }
        }

        _openNotification() {
            if (this._isOpen) return;
            this._isOpen = true;

            // Sync notifications before showing
            this._syncNotifications();

            // Position popup above the button
            const [buttonX, buttonY] = this.get_transformed_position();
            const [buttonWidth, buttonHeight] = this.get_size();
            const monitor = this._winbar?._monitor || Main.layoutManager.primaryMonitor;
            const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

            // Set size
            const popupWidth = 350;
            const popupHeight = 400;
            this._notificationPopup.set_size(popupWidth, popupHeight);
            this._scrollView.set_size(popupWidth - 24, popupHeight - 60);

            this._notificationPopup.show();

            let x = buttonX + (buttonWidth / 2) - (popupWidth / 2);
            let y = buttonY - popupHeight - 8;

            // Keep within screen bounds
            if (x + popupWidth > monitor.x + monitor.width - 10)
                x = monitor.x + monitor.width - popupWidth - 10;
            if (x < monitor.x + 10)
                x = monitor.x + 10;

            this._notificationPopup.set_position(Math.round(x), Math.round(y));

            // Set initial state for animation - invisible and slightly below
            this._notificationPopup.opacity = 0;
            this._notificationPopup.translation_y = Math.round(20 * scaleFactor);

            // Delay animation slightly for X11 compatibility
            GLib.timeout_add(GLib.PRIORITY_HIGH, 16, () => {
                if (!this._notificationPopup) return GLib.SOURCE_REMOVE;

                this._notificationPopup.ease({
                    opacity: 255,
                    translation_y: 0,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                return GLib.SOURCE_REMOVE;
            });

            // Add click-outside handler
            this._notifCapturedEventId = global.stage.connect('captured-event', (actor, event) => {
                if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                    const [eventX, eventY] = event.get_coords();
                    const [popupX, popupY] = this._notificationPopup.get_transformed_position();
                    const [pw, ph] = this._notificationPopup.get_size();

                    // Check if click is outside popup and button
                    const [bx, by] = this.get_transformed_position();
                    const [bw, bh] = this.get_size();

                    const inPopup = eventX >= popupX && eventX <= popupX + pw &&
                        eventY >= popupY && eventY <= popupY + ph;
                    const inButton = eventX >= bx && eventX <= bx + bw &&
                        eventY >= by && eventY <= by + bh;

                    if (!inPopup && !inButton) {
                        this._closeNotification();
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _closeNotification() {
            if (!this._isOpen) return;
            this._isOpen = false;

            if (this._notifCapturedEventId) {
                global.stage.disconnect(this._notifCapturedEventId);
                this._notifCapturedEventId = null;
            }

            const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

            // Animate out with slide down effect
            this._notificationPopup.ease({
                opacity: 0,
                translation_y: Math.round(20 * scaleFactor),
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._notificationPopup.hide();
                    this._notificationPopup.translation_y = 0;
                },
            });
        }

        setCount(count) {
            this._updateBadge(count);
        }

        updateTheme() {
            const settings = this._extension.getSettings();
            const effectiveMode = getEffectiveThemeMode(settings);
            let iconColor;
            const isLight = effectiveMode === 2;

            if (isLight) {
                iconColor = THEME_COLORS.light.iconColor;
            } else {
                iconColor = THEME_COLORS.dark.iconColor;
            }

            this._icon.set_style(`color: ${iconColor};`);

            // Update notification popup theme
            if (this._notificationPopup) {
                const bgColor = isLight ? THEME_COLORS.light.bg : THEME_COLORS.dark.bg;
                const borderColor = isLight ? THEME_COLORS.light.border : THEME_COLORS.dark.border;
                const textColor = isLight ? THEME_COLORS.light.text : THEME_COLORS.dark.text;
                
                this._notificationPopup.set_style(`
                    background-color: ${bgColor};
                    border-radius: 12px;
                    border: 1px solid ${borderColor};
                    padding: 12px;
                `);

                if (isLight) {
                    this._notificationPopup.add_style_class_name('winbar-notification-popup-light');
                } else {
                    this._notificationPopup.remove_style_class_name('winbar-notification-popup-light');
                }
            }
        }

        destroy() {
            // Disconnect source signals
            if (this._sources) {
                this._sources.forEach((sourceData, source) => {
                    try {
                        source.disconnect(sourceData.notificationAddedId);
                        source.disconnect(sourceData.notificationRemovedId);
                    } catch (e) { /* Signal may already be disconnected */ }
                });
                this._sources.clear();
            }
            
            // Disconnect message tray signals
            if (this._sourceAddedId && Main.messageTray) {
                try { Main.messageTray.disconnect(this._sourceAddedId); } catch (e) { /* Signal may already be disconnected */ }
                this._sourceAddedId = null;
            }
            if (this._sourceRemovedId && Main.messageTray) {
                try { Main.messageTray.disconnect(this._sourceRemovedId); } catch (e) { /* Signal may already be disconnected */ }
                this._sourceRemovedId = null;
            }

            if (this._notifCapturedEventId) {
                global.stage.disconnect(this._notifCapturedEventId);
                this._notifCapturedEventId = null;
            }
            if (this._notifFocusWindowId) {
                global.display.disconnect(this._notifFocusWindowId);
                this._notifFocusWindowId = null;
            }

            // Clear notification items
            this._notificationItems.forEach((item, key) => {
                try { item.destroy(); } catch (e) { /* Actor may already be destroyed */ }
            });
            this._notificationItems.clear();

            if (this._notificationPopup) {
                try {
                    Main.layoutManager.removeChrome(this._notificationPopup);
                    this._notificationPopup.destroy();
                } catch (e) { /* Chrome may already be removed */ }
                this._notificationPopup = null;
            }

            super.destroy();
        }
    });
