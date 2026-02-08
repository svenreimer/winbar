import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { SearchDialog } from './searchDialog.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { getEffectiveThemeMode } from '../utils.js';

export const SearchButton = GObject.registerClass({
    GTypeName: 'WinbarSearchButton',
},
    class SearchButton extends St.BoxLayout {
        _init(extension, winbar) {
            super._init({
                style_class: 'winbar-search-button',
                reactive: true,
                can_focus: false,
                track_hover: true,
            });

            this._extension = extension;
            this._winbar = winbar;
            this._settings = extension.getSettings();
            this._searchDialog = null;

            this._box = new St.BoxLayout({
                style_class: 'winbar-search-box',
                x_expand: true,
            });
            this.add_child(this._box);

            this._icon = new St.Icon({
                icon_name: 'edit-find-symbolic',
                icon_size: 16,
                style_class: 'winbar-search-icon',
            });
            this._box.add_child(this._icon);

            // Writable entry directly on the taskbar
            this._entry = new St.Entry({
                style_class: 'winbar-search-entry',
                hint_text: _('Search'),
                can_focus: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._box.add_child(this._entry);

            this._clutterText = this._entry.clutter_text;
            this._clutterText.set_single_line_mode(true);
            this._clutterText.set_activatable(true);

            // Open dialog when entry gets focus
            this._clutterText.connect('key-focus-in', () => {
                this._openDialog();
            });

            // Forward text changes to the dialog
            this._clutterText.connect('text-changed', () => {
                if (this._searchDialog && this._searchDialog._isOpen && !this._searchDialog._syncingText) {
                    this._searchDialog.setSearchText(this._clutterText.get_text());
                }
            });

            // Enter activates top result
            this._clutterText.connect('activate', () => {
                if (this._searchDialog && this._searchDialog._isOpen) {
                    this._searchDialog._activateSelected();
                }
            });

            // Open dialog on click anywhere in the box
            this.connect('button-press-event', () => {
                if (this._entry.visible) {
                    this._entry.grab_key_focus();
                } else {
                    // Icon-only or hidden entry: open dialog directly
                    this._openDialog();
                }
                return Clutter.EVENT_STOP;
            });

            this._applySearchStyle();

            // Pre-construct dialog in idle for faster first open
            if (!this._settings.get_boolean('use-native-search')) {
                this._preConstructId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    this._preConstructId = null;
                    if (!this._searchDialog && this._extension) {
                        this._searchDialog = new SearchDialog(this._extension, this, this._winbar);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        _openDialog() {
            if (this._settings.get_boolean('use-native-search')) {
                this._openNativeSearch();
                return;
            }

            // Create dialog if it doesn't exist
            if (!this._searchDialog) {
                if (this._preConstructId) {
                    GLib.source_remove(this._preConstructId);
                    this._preConstructId = null;
                }
                this._searchDialog = new SearchDialog(this._extension, this, this._winbar);
            }

            if (this._searchDialog._isOpen) return;

            this._searchDialog.open();

            // Sync any text already in the taskbar entry
            const text = this._clutterText.get_text();
            if (text) {
                this._searchDialog.setSearchText(text);
            }
        }

        _openNativeSearch() {
            if (Main.overview.visible) {
                Main.overview.hide();
            } else {
                Main.overview.show();
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    const searchEntry = Main.overview.searchEntry;
                    if (searchEntry) {
                        searchEntry.grab_key_focus();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        // Called by the dialog when it closes
        clearEntry() {
            this._clutterText.set_text('');
        }

        _applySearchStyle() {
            const style = this._settings.get_enum('search-style');
            switch (style) {
                case 0: // box-with-label
                    this._icon.show();
                    this._entry.show();
                    this.remove_style_class_name('icon-only');
                    break;
                case 1: // icon-only
                    this._icon.show();
                    this._entry.hide();
                    this.add_style_class_name('icon-only');
                    break;
                case 2: // hidden
                    this.hide();
                    break;
            }
        }

        updateStyle() {
            this._applySearchStyle();
        }

        updateTheme() {
            const effectiveMode = getEffectiveThemeMode(this._settings);
            const isLight = effectiveMode === 2;

            const iconColor = isLight ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.6)';
            const textColor = isLight ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.9)';
            const hintColor = isLight ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)';

            this._icon.set_style(`color: ${iconColor};`);
            this._entry.set_style(`color: ${textColor}; caret-color: ${textColor};`);
            const hintActor = this._entry.get_first_child();
            if (hintActor instanceof St.Label) {
                hintActor.set_style(`color: ${hintColor};`);
            }
        }

        destroy() {
            if (this._preConstructId) {
                GLib.source_remove(this._preConstructId);
                this._preConstructId = null;
            }
            if (this._searchDialog) {
                try { this._searchDialog.destroy(); } catch (e) { /* ignore */ }
                this._searchDialog = null;
            }
            this._extension = null;
            this._settings = null;
            super.destroy();
        }
    });
