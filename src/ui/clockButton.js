import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { getEffectiveThemeMode, addBlurEffect } from '../utils.js';

export const ClockButton = GObject.registerClass({
    GTypeName: 'WinbarClockButton',
},
    class ClockButton extends St.Button {
        _init(extension, winbar) {
            super._init({
                style_class: 'winbar-clock-button',
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            this._extension = extension;
            this._winbar = winbar;
            this._settings = extension.getSettings();
            this._displayedMonth = null;
            this._displayedYear = null;
            this._isOpen = false;
            this._isDestroyed = false;

            const box = new St.BoxLayout({
                vertical: true,
                style_class: 'winbar-clock-box',
            });
            this.set_child(box);

            this._timeLabel = new St.Label({
                style_class: 'winbar-time-label',
                x_align: Clutter.ActorAlign.END,
            });
            box.add_child(this._timeLabel);

            this._dateLabel = new St.Label({
                style_class: 'winbar-date-label',
                x_align: Clutter.ActorAlign.END,
            });
            box.add_child(this._dateLabel);

            // Create calendar popup as simple St.Widget (not PopupMenu)
            this._calendarBox = new St.BoxLayout({
                vertical: true,
                style_class: 'winbar-calendar-popup',
                reactive: true,
            });
            this._calendarBox.hide();
            Main.layoutManager.addChrome(this._calendarBox, { affectsStruts: false });
            this._calendarBox.connect('destroy', () => { this._calendarBox = null; });

            // Add blur effect for modern frosted glass look
            addBlurEffect(this._calendarBox);

            // Build calendar UI
            this._buildCalendarUI();

            this.connect('clicked', () => {
                this._resetToCurrentMonth();
                this._updateCalendar();
                this._toggleCalendar();
            });

            // Watch for focus changes - close popup when another window gets focus
            this._calFocusWindowId = global.display.connect('notify::focus-window', () => {
                const focusWindow = global.display.get_focus_window();
                if (focusWindow && this._isOpen) {
                    this._closeCalendar();
                }
            });

            this._applySettings();
            this._updateClock();
            this._clockTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._updateClock();
                return GLib.SOURCE_CONTINUE;
            });

            this.connect('destroy', () => {
                this.cleanup();
            });
        }

        // Explicit cleanup method - call this before destroy to avoid GC issues
        cleanup() {
            if (this._isDestroyed) return;
            this._isDestroyed = true;
            
            // Disconnect global signals FIRST
            if (this._calCapturedEventId) {
                try {
                    global.stage.disconnect(this._calCapturedEventId);
                } catch (e) { /* ignore */ }
                this._calCapturedEventId = null;
            }
            if (this._calFocusWindowId) {
                try {
                    global.display.disconnect(this._calFocusWindowId);
                } catch (e) { /* ignore */ }
                this._calFocusWindowId = null;
            }

            // Clear timeouts
            if (this._clockTimer) {
                GLib.source_remove(this._clockTimer);
                this._clockTimer = null;
            }

            // Destroy UI elements safely
            if (this._calendarBox) {
                const box = this._calendarBox;
                this._calendarBox = null;
                try {
                    Main.layoutManager.removeChrome(box);
                    box.destroy();
                } catch (e) {
                    // Ignore errors if already disposed
                }
            }
        }

        _toggleCalendar() {
            if (this._isOpen) {
                this._closeCalendar();
            } else {
                this._openCalendar();
            }
        }

        _openCalendar() {
            if (this._isOpen) return;
            this._isOpen = true;

            // Position popup above the button
            const [buttonX, buttonY] = this.get_transformed_position();
            const [buttonWidth, buttonHeight] = this.get_size();
            const monitor = this._winbar?._monitor || Main.layoutManager.primaryMonitor;
            const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

            this._calendarBox.show();
            const [, popupHeight] = this._calendarBox.get_preferred_height(-1);
            const [, popupWidth] = this._calendarBox.get_preferred_width(-1);

            let x = buttonX + (buttonWidth / 2) - (popupWidth / 2);
            let y = buttonY - popupHeight - 8;

            // Keep within screen bounds
            if (x + popupWidth > monitor.x + monitor.width - 10)
                x = monitor.x + monitor.width - popupWidth - 10;
            if (x < monitor.x + 10)
                x = monitor.x + 10;

            this._calendarBox.set_position(Math.round(x), Math.round(y));

            // Set initial state for animation - invisible and slightly below
            this._calendarBox.opacity = 0;
            this._calendarBox.translation_y = Math.round(20 * scaleFactor);

            // Delay animation slightly for X11 compatibility (like StartMenu)
            GLib.timeout_add(GLib.PRIORITY_HIGH, 16, () => {
                if (!this._calendarBox) return GLib.SOURCE_REMOVE;

                this._calendarBox.ease({
                    opacity: 255,
                    translation_y: 0,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                return GLib.SOURCE_REMOVE;
            });

            // Add click-outside handler
            this._calCapturedEventId = global.stage.connect('captured-event', (actor, event) => {
                if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                    const [eventX, eventY] = event.get_coords();
                    const [popupX, popupY] = this._calendarBox.get_transformed_position();
                    const [pw, ph] = this._calendarBox.get_size();

                    // Check if click is outside popup and button
                    const [bx, by] = this.get_transformed_position();
                    const [bw, bh] = this.get_size();

                    const inPopup = eventX >= popupX && eventX <= popupX + pw &&
                        eventY >= popupY && eventY <= popupY + ph;
                    const inButton = eventX >= bx && eventX <= bx + bw &&
                        eventY >= by && eventY <= by + bh;

                    if (!inPopup && !inButton) {
                        this._closeCalendar();
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _closeCalendar() {
            if (!this._isOpen) return;
            this._isOpen = false;

            if (this._calCapturedEventId) {
                global.stage.disconnect(this._calCapturedEventId);
                this._calCapturedEventId = null;
            }

            const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

            // Animate out with slide down effect
            this._calendarBox.ease({
                opacity: 0,
                translation_y: Math.round(20 * scaleFactor),
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._calendarBox.hide();
                    this._calendarBox.translation_y = 0;
                },
            });
        }

        _buildCalendarUI() {
            this._calendarExpanded = true;

            // Header with date and expand button
            const headerBox = new St.BoxLayout({
                style_class: 'winbar-calendar-header',
                x_expand: true,
            });

            this._headerDateLabel = new St.Label({
                style_class: 'winbar-calendar-header-date',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            });
            headerBox.add_child(this._headerDateLabel);

            this._expandIcon = new St.Icon({
                icon_name: 'pan-down-symbolic',
                icon_size: 16,
            });
            this._expandButton = new St.Button({
                style_class: 'winbar-calendar-expand-btn',
                child: this._expandIcon,
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            this._expandButton.connect('clicked', () => this._toggleCalendarExpanded());
            headerBox.add_child(this._expandButton);

            this._calendarBox.add_child(headerBox);

            // Collapsible calendar section
            this._calendarSection = new St.BoxLayout({
                vertical: true,
                style_class: 'winbar-calendar-section',
            });

            // Month navigation
            this._monthNavBox = new St.BoxLayout({
                style_class: 'winbar-calendar-month-nav',
                x_expand: true,
            });

            this._monthLabel = new St.Label({
                style_class: 'winbar-calendar-month-label',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            });
            this._monthNavBox.add_child(this._monthLabel);

            const navButtonsBox = new St.BoxLayout({
                style_class: 'winbar-calendar-nav-buttons',
            });

            const prevButton = new St.Button({
                style_class: 'winbar-calendar-nav-btn',
                child: new St.Icon({
                    icon_name: 'pan-up-symbolic',
                    icon_size: 14,
                }),
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            prevButton.connect('clicked', () => this._changeMonth(-1));
            navButtonsBox.add_child(prevButton);

            const nextButton = new St.Button({
                style_class: 'winbar-calendar-nav-btn',
                child: new St.Icon({
                    icon_name: 'pan-down-symbolic',
                    icon_size: 14,
                }),
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            nextButton.connect('clicked', () => this._changeMonth(1));
            navButtonsBox.add_child(nextButton);

            this._monthNavBox.add_child(navButtonsBox);
            this._calendarSection.add_child(this._monthNavBox);

            // Weekday headers
            this._weekdayBox = new St.BoxLayout({
                style_class: 'winbar-calendar-weekdays',
                x_expand: true,
            });

            const weekdays = [_('Mo'), _('Tu'), _('We'), _('Th'), _('Fr'), _('Sa'), _('Su')];
            for (const day of weekdays) {
                const label = new St.Label({
                    text: day,
                    style_class: 'winbar-calendar-weekday',
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                });
                this._weekdayBox.add_child(label);
            }
            this._calendarSection.add_child(this._weekdayBox);

            // Calendar grid
            this._calendarGrid = new St.BoxLayout({
                vertical: true,
                style_class: 'winbar-calendar-grid',
            });
            this._calendarSection.add_child(this._calendarGrid);

            this._calendarBox.add_child(this._calendarSection);

            // Add scroll event for changing months (like Windows)
            this._calendarSection.reactive = true;
            this._calendarSection.connect('scroll-event', (actor, event) => {
                const direction = event.get_scroll_direction();
                if (direction === Clutter.ScrollDirection.UP) {
                    this._changeMonth(-1);
                    return Clutter.EVENT_STOP;
                } else if (direction === Clutter.ScrollDirection.DOWN) {
                    this._changeMonth(1);
                    return Clutter.EVENT_STOP;
                } else if (direction === Clutter.ScrollDirection.SMOOTH) {
                    // Handle smooth scrolling (touchpads)
                    const [, dy] = event.get_scroll_delta();
                    if (!this._scrollAccumulator) {
                        this._scrollAccumulator = 0;
                    }
                    this._scrollAccumulator += dy;

                    // Trigger month change when accumulated scroll exceeds threshold
                    if (this._scrollAccumulator >= 1.0) {
                        this._changeMonth(1);
                        this._scrollAccumulator = 0;
                        return Clutter.EVENT_STOP;
                    } else if (this._scrollAccumulator <= -1.0) {
                        this._changeMonth(-1);
                        this._scrollAccumulator = 0;
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _toggleCalendarExpanded() {
            this._calendarExpanded = !this._calendarExpanded;
            this._calendarSection.visible = this._calendarExpanded;
            this._expandIcon.icon_name = this._calendarExpanded ? 'pan-down-symbolic' : 'pan-up-symbolic';

            // Reposition popup after size change
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._repositionCalendar();
                return GLib.SOURCE_REMOVE;
            });
        }

        _repositionCalendar() {
            if (!this._isOpen || !this._calendarBox.visible) return;

            const [buttonX, buttonY] = this.get_transformed_position();
            const [buttonWidth] = this.get_size();
            const monitor = Main.layoutManager.primaryMonitor;

            const [, popupHeight] = this._calendarBox.get_preferred_height(-1);
            const [, popupWidth] = this._calendarBox.get_preferred_width(-1);

            let x = buttonX + (buttonWidth / 2) - (popupWidth / 2);
            let y = buttonY - popupHeight - 8;

            // Keep within screen bounds
            if (x + popupWidth > monitor.x + monitor.width - 10)
                x = monitor.x + monitor.width - popupWidth - 10;
            if (x < monitor.x + 10)
                x = monitor.x + 10;

            this._calendarBox.set_position(Math.round(x), Math.round(y));
        }

        _resetToCurrentMonth() {
            const now = GLib.DateTime.new_now_local();
            this._displayedMonth = now.get_month();
            this._displayedYear = now.get_year();
        }

        _changeMonth(delta) {
            this._displayedMonth += delta;
            if (this._displayedMonth > 12) {
                this._displayedMonth = 1;
                this._displayedYear++;
            } else if (this._displayedMonth < 1) {
                this._displayedMonth = 12;
                this._displayedYear--;
            }
            this._updateCalendar();
        }

        _updateCalendar() {
            const now = GLib.DateTime.new_now_local();
            const todayDay = now.get_day_of_month();
            const todayMonth = now.get_month();
            const todayYear = now.get_year();

            // Update header date
            this._headerDateLabel.set_text(now.format('%A, %e. %B'));

            // Update month label
            const displayDate = GLib.DateTime.new_local(
                this._displayedYear, this._displayedMonth, 1, 0, 0, 0
            );
            this._monthLabel.set_text(displayDate.format('%B %Y'));

            // Clear existing grid
            this._calendarGrid.destroy_all_children();

            // Get first day of month and number of days
            const firstOfMonth = GLib.DateTime.new_local(
                this._displayedYear, this._displayedMonth, 1, 0, 0, 0
            );
            const firstDayOfWeek = firstOfMonth.get_day_of_week(); // 1 = Monday, 7 = Sunday

            // Get days in month
            const daysInMonth = this._getDaysInMonth(this._displayedYear, this._displayedMonth);
            const daysInPrevMonth = this._getDaysInMonth(
                this._displayedMonth === 1 ? this._displayedYear - 1 : this._displayedYear,
                this._displayedMonth === 1 ? 12 : this._displayedMonth - 1
            );

            // Build calendar rows
            let dayNum = 1;
            let nextMonthDay = 1;
            const startOffset = firstDayOfWeek - 1; // Days to show from previous month

            for (let week = 0; week < 6; week++) {
                const weekBox = new St.BoxLayout({
                    style_class: 'winbar-calendar-week',
                    x_expand: true,
                });

                for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
                    const cellIndex = week * 7 + dayOfWeek;
                    let displayDay;
                    let isCurrentMonth = true;
                    let isToday = false;

                    if (cellIndex < startOffset) {
                        // Previous month
                        displayDay = daysInPrevMonth - startOffset + cellIndex + 1;
                        isCurrentMonth = false;
                    } else if (dayNum <= daysInMonth) {
                        // Current month
                        displayDay = dayNum;
                        isToday = (dayNum === todayDay &&
                            this._displayedMonth === todayMonth &&
                            this._displayedYear === todayYear);
                        dayNum++;
                    } else {
                        // Next month
                        displayDay = nextMonthDay;
                        nextMonthDay++;
                        isCurrentMonth = false;
                    }

                    const dayButton = new St.Button({
                        label: String(displayDay),
                        style_class: 'winbar-calendar-day',
                        x_expand: true,
                        reactive: true,
                        can_focus: true,
                        track_hover: true,
                    });

                    if (!isCurrentMonth) {
                        dayButton.add_style_class_name('other-month');
                    }
                    if (isToday) {
                        dayButton.add_style_class_name('today');
                    }

                    weekBox.add_child(dayButton);
                }

                this._calendarGrid.add_child(weekBox);

                // Stop if we've shown all days and completed the week
                if (dayNum > daysInMonth && week >= 4) {
                    break;
                }
            }
        }

        _getDaysInMonth(year, month) {
            // Use UTC to avoid DST offset causing off-by-one errors
            const date = GLib.DateTime.new_utc(year, month, 1, 0, 0, 0);
            if (month === 12) {
                const nextYear = GLib.DateTime.new_utc(year + 1, 1, 1, 0, 0, 0);
                return (nextYear.to_unix() - date.to_unix()) / 86400;
            } else {
                const nextMonth = GLib.DateTime.new_utc(year, month + 1, 1, 0, 0, 0);
                return (nextMonth.to_unix() - date.to_unix()) / 86400;
            }
        }

        _applySettings() {
            this._dateLabel.visible = this._settings.get_boolean('show-date');
        }

        _updateClock() {
            // Guard against disposed objects
            if (!this._timeLabel || !this._dateLabel || !this._settings) return;

            try {
                const now = GLib.DateTime.new_now_local();
                const clockFormat = this._settings.get_enum('clock-format');

                if (clockFormat === 0) {
                    // 24-hour format
                    this._timeLabel.set_text(now.format('%H:%M'));
                } else {
                    // 12-hour format
                    this._timeLabel.set_text(now.format('%I:%M %p'));
                }

                this._dateLabel.set_text(now.format('%d.%m.%Y'));
            } catch (e) {
                // Ignore errors during cleanup
            }
        }

        updateSettings() {
            this._applySettings();
            this._updateClock();
        }

        updateTheme() {
            const effectiveMode = getEffectiveThemeMode(this._settings);
            let textColor, secondaryTextColor;
            const isLight = effectiveMode === 2;

            if (isLight) {
                // Light mode
                textColor = '#000000';
                secondaryTextColor = 'rgba(0, 0, 0, 0.7)';
            } else {
                // Dark mode
                textColor = '#ffffff';
                secondaryTextColor = 'rgba(255, 255, 255, 0.7)';
            }

            this._timeLabel.set_style(`color: ${textColor};`);
            this._dateLabel.set_style(`color: ${secondaryTextColor};`);

            // Update calendar box theme
            if (this._calendarBox) {
                if (isLight) {
                    this._calendarBox.add_style_class_name('winbar-calendar-popup-light');
                } else {
                    this._calendarBox.remove_style_class_name('winbar-calendar-popup-light');
                }
            }
        }
    });
