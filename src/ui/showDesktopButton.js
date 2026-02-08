import GObject from 'gi://GObject';
import St from 'gi://St';
import Meta from 'gi://Meta';

import { TASKBAR_HEIGHT, ANIMATION_TIME } from '../constants.js';

export const ShowDesktopButton = GObject.registerClass({
    GTypeName: 'WinbarShowDesktopButton',
},
    class ShowDesktopButton extends St.Button {
        _init(extension) {
            super._init({
                style_class: 'winbar-show-desktop',
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            this._extension = extension;
            this._desktopShown = false;
            this._minimizedWindows = [];

            // Use scaled height if available, otherwise use default
            const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const height = Math.round(TASKBAR_HEIGHT * scaleFactor);
            this.set_size(8 * scaleFactor, height);

            this.connect('clicked', () => {
                this._toggleDesktop();
            });

            this.connect('enter-event', () => {
                // Aero peek preview
                this._peekDesktop();
            });

            this.connect('leave-event', () => {
                this._unpeekDesktop();
            });
        }

        _toggleDesktop() {
            const windows = global.get_window_actors()
                .map(a => a.meta_window)
                .filter(w => !w.is_skip_taskbar() && w.get_window_type() === Meta.WindowType.NORMAL);

            if (this._desktopShown) {
                // Restore windows
                this._minimizedWindows.forEach(w => {
                    if (w && !w.is_destroyed)
                        w.unminimize();
                });
                this._minimizedWindows = [];
                this._desktopShown = false;
            } else {
                // Minimize all windows
                this._minimizedWindows = windows.filter(w => !w.minimized);
                windows.forEach(w => w.minimize());
                this._desktopShown = true;
            }
        }

        _peekDesktop() {
            global.get_window_actors().forEach(actor => {
                if (actor.meta_window.get_window_type() === Meta.WindowType.NORMAL) {
                    actor.ease({
                        opacity: 50,
                        duration: ANIMATION_TIME,
                    });
                }
            });
        }

        _unpeekDesktop() {
            global.get_window_actors().forEach(actor => {
                actor.ease({
                    opacity: 255,
                    duration: ANIMATION_TIME,
                });
            });
        }
    });
