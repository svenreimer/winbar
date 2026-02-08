import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';
import AccountsService from 'gi://AccountsService';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { getEffectiveThemeMode, addBlurEffect } from '../utils.js';
import {
    ANIMATION_TIME,
    ANIMATION_FRAME_DELAY,
    ICON_SIZE,
    MENU_OFFSET_PX,
    MENU_SCREEN_PADDING_PX,
    STANDARD_CATEGORIES,
    THEME_COLORS,
    DEFAULT_SEARCH_SYNONYMS,
} from '../constants.js';

export const StartMenu = GObject.registerClass({
    GTypeName: 'WinbarStartMenu',
    Signals: {
        'menu-closed': {},
    }
}, class StartMenu extends St.Widget {
    _init(extension, winbar) {
        super._init({
            style_class: 'winbar-start-menu',
            reactive: true,
            visible: false,
        });

        this._extension = extension;
        this._winbar = winbar;
        this._settings = extension.getSettings();
        this._isOpen = false;

        // Drag and drop state
        this._dragSourceButton = null;
        this._dragStarted = false;
        this._dropTargetIndex = null;
        this._pinnedButtons = [];

        // Search learning and current query tracking
        this._currentSearchQuery = '';
        this._loadSearchLearning();
        this._initSearchSynonyms();

        // Main container with rounded corners
        this._container = new St.BoxLayout({
            style_class: 'winbar-start-menu-container',
            vertical: true,
        });
        this.add_child(this._container);

        // Add blur effect for modern look
        this._addBlurEffect();

        // Build the menu sections
        this._buildSearchSection();

        // Main scrollable content area
        this._mainScroll = new St.ScrollView({
            style_class: 'winbar-start-main-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            y_expand: true,
        });
        this._container.add_child(this._mainScroll);

        // Build search results container (hidden by default, shown during search)
        this._buildSearchResults();

        // Scrollable content container
        this._scrollContent = new St.BoxLayout({
            style_class: 'winbar-start-scroll-content',
            vertical: true,
        });
        this._mainScroll.set_child(this._scrollContent);

        this._buildPinnedSection();
        this._buildRecommendedSection();
        this._buildCategorySection();
        this._buildBottomBar();

        // Build context menu for app items
        this._buildAppContextMenu();

        // Load content
        this._loadPinnedApps();
        this._loadRecentFiles();
        this._loadAllAppsGrid();

        // Listen for pinned apps changes to refresh
        this._pinnedAppsChangedId = this._settings.connect('changed::start-menu-pinned-apps', () => {
            this._refreshPinnedApps();
        });

        // Global motion handler for drag operations
        this._dragMotionId = this.connect('motion-event', (actor, event) => {
            if (this._dragStarted && this._dragSourceButton) {
                const [x, y] = event.get_coords();
                this._updateDropTarget(x, y);
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Global button release handler for drag operations
        this._dragReleaseId = this.connect('button-release-event', (actor, event) => {
            if (this._dragStarted && this._dragSourceButton) {
                const btn = this._dragSourceButton;
                btn.opacity = 255;
                btn.remove_style_class_name('dragging');

                // Remove the drag clone
                this._destroyDragClone();

                if (this._dropTargetIndex !== null && this._dropTargetIndex !== btn._pinnedIndex) {
                    this._reorderPinnedApp(btn._pinnedIndex, this._dropTargetIndex);
                }

                this._clearDropIndicators();
                this._dragSourceButton = null;
                this._dragStarted = false;
                this._dropTargetIndex = null;

                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Apply theme
        this.updateTheme();

        // Ensure menu starts hidden
        this.hide();
        this._isOpen = false;

        // Close on click outside
        this.connect('button-press-event', (actor, event) => {
            const [x, y] = event.get_coords();
            const [actorX, actorY] = this._container.get_transformed_position();
            const [actorW, actorH] = this._container.get_size();

            // Close context menu if clicking outside it
            if (this._appContextMenuScroll && this._appContextMenuScroll.visible) {
                const [menuX, menuY] = this._appContextMenuScroll.get_transformed_position();
                const [menuW, menuH] = this._appContextMenuScroll.get_size();

                const isOnMenu = x >= menuX && x <= menuX + menuW && y >= menuY && y <= menuY + menuH;

                if (!isOnMenu) {
                    this._hideAppContextMenu();
                }
            }

            // Close sort menu if clicking outside it AND not on the sort button
            if (this._sortMenu && this._sortMenu.visible) {
                const [sortX, sortY] = this._sortMenu.get_transformed_position();
                const [sortW, sortH] = this._sortMenu.get_size();
                const [btnX, btnY] = this._sortBtn.get_transformed_position();
                const [btnW, btnH] = this._sortBtn.get_size();

                const isOnMenu = x >= sortX && x <= sortX + sortW && y >= sortY && y <= sortY + sortH;
                const isOnBtn = x >= btnX && x <= btnX + btnW && y >= btnY && y <= btnY + btnH;

                if (!isOnMenu && !isOnBtn) {
                    this._sortMenu.hide();
                }
            }

            if (x < actorX || x > actorX + actorW || y < actorY || y > actorY + actorH) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            // Let child widgets handle clicks inside the container
            return Clutter.EVENT_PROPAGATE;
        });
    }

    // Helper to check if click is on power menu or power button
    _isClickOnPowerArea(x, y) {
        // Check power button
        const [btnX, btnY] = this._powerButton.get_transformed_position();
        const [btnW, btnH] = this._powerButton.get_size();
        if (x >= btnX && x <= btnX + btnW && y >= btnY && y <= btnY + btnH) {
            return true;
        }

        // Check power menu if visible
        if (this._powerMenu.visible) {
            const [menuX, menuY] = this._powerMenu.get_transformed_position();
            const [menuW, menuH] = this._powerMenu.get_size();
            if (x >= menuX && x <= menuX + menuW && y >= menuY && y <= menuY + menuH) {
                return true;
            }
        }

        return false;
    }

    _buildSearchSection() {
        this._searchSection = new St.BoxLayout({
            style_class: 'winbar-start-search-section',
        });
        this._container.add_child(this._searchSection);

        this._searchEntry = new St.Entry({
            style_class: 'winbar-start-search-entry',
            hint_text: _('Search for apps, settings and documents'),
            can_focus: true,
            x_expand: true,
        });
        this._searchSection.add_child(this._searchEntry);

        // Search icon
        this._searchEntry.set_primary_icon(new St.Icon({
            icon_name: 'edit-find-symbolic',
            icon_size: 16,
            style_class: 'winbar-start-search-icon',
        }));

        // Search functionality
        this._searchEntry.clutter_text.connect('text-changed', () => {
            this._onSearchTextChanged();
        });

        this._searchEntry.clutter_text.connect('key-press-event', (actor, event) => {
            const key = event.get_key_symbol();

            if (key === Clutter.KEY_Escape) {
                if (this._searchEntry.get_text() !== '') {
                    this._searchEntry.set_text('');
                } else {
                    this.close();
                }
                return Clutter.EVENT_STOP;
            }

            // Handle arrow key navigation in search results
            if (key === Clutter.KEY_Down || key === Clutter.KEY_Up) {
                if (this._searchResults && this._searchResults.visible && this._searchResultButtons.length > 0) {
                    if (key === Clutter.KEY_Down) {
                        this._selectSearchResult(this._selectedSearchIndex + 1);
                    } else {
                        this._selectSearchResult(this._selectedSearchIndex - 1);
                    }
                    return Clutter.EVENT_STOP;
                }
            }

            // Handle Enter to launch selected result
            if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
                if (this._searchResults && this._searchResults.visible &&
                    this._selectedSearchIndex >= 0 &&
                    this._selectedSearchIndex < this._searchResultButtons.length) {
                    const selectedButton = this._searchResultButtons[this._selectedSearchIndex];
                    if (selectedButton && selectedButton._appId) {
                        try {
                            // Record this selection for search learning
                            if (this._currentSearchQuery && this._currentSearchQuery.length >= 2) {
                                this._recordSearchSelection(this._currentSearchQuery, selectedButton._appId);
                            }

                            const freshApp = Shell.AppSystem.get_default().lookup_app(selectedButton._appId);
                            if (freshApp) {
                                // Open new window if possible, otherwise activate
                                if (typeof freshApp.open_new_window === 'function') {
                                    freshApp.open_new_window(-1);
                                } else {
                                    freshApp.activate();
                                }
                            }
                        } catch (e) {
                            log(`[Winbar] Failed to activate app: ${e.message}`);
                        }
                        this.close();
                    } else {
                        log(`[Winbar] No appId found on selected button`);
                    }
                    return Clutter.EVENT_STOP;
                } else {
                    log(`[Winbar] Enter pressed but conditions not met: visible=${this._searchResults?.visible}, index=${this._selectedSearchIndex}, length=${this._searchResultButtons?.length}`);
                }
            }

            return Clutter.EVENT_PROPAGATE;
        });
    }

    _buildSearchResults() {
        // Search results list view (replaces grid view during search)
        this._searchResults = new St.BoxLayout({
            style_class: 'winbar-search-results',
            vertical: true,
            visible: false,
            y_expand: true,
        });
        this._container.add_child(this._searchResults);

        // Scroll view for search results
        this._searchResultsScroll = new St.ScrollView({
            style_class: 'winbar-search-results-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            y_expand: true,
        });
        this._searchResults.add_child(this._searchResultsScroll);

        // Container for search result items
        this._searchResultsBox = new St.BoxLayout({
            style_class: 'winbar-search-results-box',
            vertical: true,
            x_expand: true,
        });
        this._searchResultsScroll.set_child(this._searchResultsBox);

        // Track search result buttons and selection
        this._searchResultButtons = [];
        this._selectedSearchIndex = -1;
    }

    _buildPinnedSection() {
        // Header
        const pinnedHeader = new St.BoxLayout({
            style_class: 'winbar-start-section-header',
        });
        this._scrollContent.add_child(pinnedHeader);

        pinnedHeader.add_child(new St.Label({
            text: _('Pinned'),
            style_class: 'winbar-start-section-title',
            x_expand: true,
        }));

        // Pinned apps grid (no scroll view - main area scrolls)
        this._pinnedGrid = new St.Widget({
            style_class: 'winbar-start-pinned-grid',
            layout_manager: new Clutter.GridLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                column_spacing: 8,
                row_spacing: 8,
            }),
        });
        this._scrollContent.add_child(this._pinnedGrid);

        // Store for search filtering
        this._pinnedApps = [];
    }

    _buildRecommendedSection() {
        // Header
        const recommendedHeader = new St.BoxLayout({
            style_class: 'winbar-start-section-header',
        });
        this._scrollContent.add_child(recommendedHeader);

        recommendedHeader.add_child(new St.Label({
            text: _('Recommended'),
            style_class: 'winbar-start-section-title',
            x_expand: true,
        }));

        // Recommended items container (2 columns)
        this._recommendedBox = new St.Widget({
            style_class: 'winbar-start-recommended-box',
            layout_manager: new Clutter.GridLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                column_spacing: 12,
                row_spacing: 4,
                column_homogeneous: true,
            }),
            x_expand: true,
        });
        this._scrollContent.add_child(this._recommendedBox);
    }

    _buildCategorySection() {
        // Header for "All" section with sorting dropdown
        const allHeader = new St.BoxLayout({
            style_class: 'winbar-start-section-header',
        });
        this._scrollContent.add_child(allHeader);

        allHeader.add_child(new St.Label({
            text: _('All'),
            style_class: 'winbar-start-section-title',
            x_expand: true,
        }));

        // Sorting dropdown button
        this._sortLabel = new St.Label({ text: _('Sort (A-Z)') });
        const sortBtnBox = new St.BoxLayout({ style_class: 'winbar-start-sort-btn-box' });
        sortBtnBox.add_child(this._sortLabel);
        sortBtnBox.add_child(new St.Icon({ icon_name: 'pan-down-symbolic', icon_size: 12 }));

        this._sortBtn = new St.Button({
            style_class: 'winbar-start-section-button',
            child: sortBtnBox,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        this._sortBtn.connect('clicked', () => {
            this._toggleSortMenu();
        });
        allHeader.add_child(this._sortBtn);

        // Sort options menu (hidden by default)
        this._sortMenu = new St.BoxLayout({
            style_class: 'winbar-start-sort-menu',
            vertical: true,
            visible: false,
        });
        this.add_child(this._sortMenu);

        // Sort options
        const sortOptions = [
            { id: 'az', label: _('A-Z') },
            { id: 'za', label: _('Z-A') },
            { id: 'recent', label: _('Most Used') },
            { id: 'category', label: _('Category') },
        ];

        for (const opt of sortOptions) {
            const item = new St.Button({
                style_class: 'winbar-start-sort-menu-item',
                label: opt.label,
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            item.connect('clicked', () => {
                this._currentSort = opt.id;
                this._sortLabel.set_text(_('Sort (%s)').format(opt.label));
                this._sortMenu.hide();
                this._loadAllAppsGrid();
            });
            this._sortMenu.add_child(item);
        }

        this._currentSort = 'az';

        // All apps grid (no separate scroll - main area scrolls)
        this._allAppsGrid = new St.Widget({
            style_class: 'winbar-start-all-grid',
            layout_manager: new Clutter.GridLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                column_spacing: 8,
                row_spacing: 8,
            }),
        });
        this._scrollContent.add_child(this._allAppsGrid);

        // Store for search filtering
        this._allAppsButtons = [];
    }

    _toggleSortMenu() {
        if (this._sortMenu.visible) {
            this._sortMenu.hide();
        } else {
            // Position the menu below the sort button
            const [btnX, btnY] = this._sortBtn.get_transformed_position();
            const [selfX, selfY] = this.get_transformed_position();
            const [, btnH] = this._sortBtn.get_preferred_height(-1);

            this._sortMenu.set_position(btnX - selfX, btnY - selfY + btnH + 4);
            this._sortMenu.show();
        }
    }

    _buildAppContextMenu() {
        // Create a floating context menu for app items with scrolling support
        this._appContextMenuScroll = new St.ScrollView({
            style_class: 'winbar-start-context-menu',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            visible: false,
        });
        this.add_child(this._appContextMenuScroll);

        this._appContextMenu = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        this._appContextMenuScroll.set_child(this._appContextMenu);

        this._appContextMenuAppId = null;
    }

    _getContextMenuApp() {
        // Get fresh app reference from stored ID
        if (!this._appContextMenuAppId) return null;
        const appSystem = Shell.AppSystem.get_default();
        return appSystem.lookup_app(this._appContextMenuAppId);
    }

    _addToDesktop(app) {
        if (!app) return;

        try {
            // Get desktop directory
            const desktopDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
            if (!desktopDir) {
                Main.notify(_('Winbar'), _('Could not find Desktop directory'));
                return;
            }

            // Ensure we have a local desktop file
            const paths = this._getLocalDesktopFilePath(app);
            if (!paths) {
                Main.notify(_('Winbar'), _('Could not get application info'));
                return;
            }

            const sourceFile = Gio.File.new_for_path(paths.original);
            const destPath = GLib.build_filenamev([desktopDir, paths.basename]);
            const destFile = Gio.File.new_for_path(destPath);

            // Check if already exists
            if (destFile.query_exists(null)) {
                Main.notify(_('Winbar'), _('Shortcut already exists on Desktop'));
                return;
            }

            // Copy file
            sourceFile.copy(destFile, Gio.FileCopyFlags.NONE, null, null);

            // Allow execution (chmod +x)
            try {
                // 0o755 = rwxr-xr-x
                destFile.set_attribute_uint32('unix::mode', 0o755, Gio.FileQueryInfoFlags.NONE, null);
            } catch (e) {
                // Ignore chmod errors, might not be supported on all filesystems
            }

            Main.notify(_('Winbar'), _('Added to Desktop'));
        } catch (e) {
            log(`[Winbar] Error adding to desktop: ${e.message}`);
            Main.notify(_('Winbar'), _('Failed to add to Desktop'));
        }
    }

    _showAppContextMenu(app, x, y) {
        // Validate app object first
        if (!app || typeof app.get_id !== 'function') {
            return;
        }

        // Store app ID (not the app object itself - it can become stale)
        const appId = app.get_id();
        if (!appId) {
            return;
        }

        // Clear previous items
        this._appContextMenu.destroy_all_children();
        this._appContextMenuAppId = appId;

        // Check if pinned in Start Menu (using our separate setting)
        const pinnedAppIds = this._settings.get_strv('start-menu-pinned-apps');
        const isPinnedInStartMenu = pinnedAppIds.includes(appId);

        // Pin/Unpin from Start
        const pinItem = this._createContextMenuItem(
            isPinnedInStartMenu ? 'list-remove-symbolic' : 'view-pin-symbolic',
            isPinnedInStartMenu ? _('Unpin from Start') : _('Pin to Start'),
            () => {
                const theApp = this._getContextMenuApp();
                if (!theApp) return;
                try {
                    const currentPinned = this._settings.get_strv('start-menu-pinned-apps');
                    const theAppId = theApp.get_id();
                    if (isPinnedInStartMenu) {
                        // Remove from pinned
                        const newPinned = currentPinned.filter(id => id !== theAppId);
                        this._settings.set_strv('start-menu-pinned-apps', newPinned);
                    } else {
                        // Add to pinned
                        currentPinned.push(theAppId);
                        this._settings.set_strv('start-menu-pinned-apps', currentPinned);
                    }
                } catch (e) {
                    log(`[Winbar] Error modifying Start Menu pinned apps: ${e.message}`);
                }
                this._hideAppContextMenu();
                // Refresh pinned apps
                this._refreshPinnedApps();
            }
        );
        this._appContextMenu.add_child(pinItem);

        // Pin/Unpin from Taskbar (uses AppFavorites)
        const isPinnedToTaskbar = AppFavorites.getAppFavorites().isFavorite(appId);
        const pinTaskbarItem = this._createContextMenuItem(
            isPinnedToTaskbar ? 'list-remove-symbolic' : 'view-pin-symbolic',
            isPinnedToTaskbar ? _('Unpin from taskbar') : _('Pin to taskbar'),
            () => {
                const theApp = this._getContextMenuApp();
                if (!theApp) return;
                try {
                    if (isPinnedToTaskbar) {
                        AppFavorites.getAppFavorites().removeFavorite(theApp.get_id());
                    } else {
                        AppFavorites.getAppFavorites().addFavorite(theApp.get_id());
                    }
                } catch (e) {
                    log(`[Winbar] Error modifying taskbar favorites: ${e.message}`);
                }
                this._hideAppContextMenu();
            }
        );
        this._appContextMenu.add_child(pinTaskbarItem);

        // Separator
        this._appContextMenu.add_child(new St.Widget({
            style_class: 'winbar-start-context-menu-separator',
            height: 1,
            x_expand: true,
        }));

        // Add to Desktop
        const addToDesktopItem = this._createContextMenuItem(
            'user-desktop-symbolic',
            _('Add to Desktop'),
            () => {
                const theApp = this._getContextMenuApp();
                this._addToDesktop(theApp);
                this._hideAppContextMenu();
                this.close();
            }
        );
        this._appContextMenu.add_child(addToDesktopItem);

        // Open file location (for desktop files)
        const openLocationItem = this._createContextMenuItem(
            'folder-symbolic',
            _('Open file location'),
            () => {
                this._hideAppContextMenu();
                const theApp = this._getContextMenuApp();
                if (!theApp) return;
                try {
                    const appInfo = theApp.get_app_info?.();
                    if (appInfo) {
                        const filename = appInfo.get_filename();
                        if (filename) {
                            const file = Gio.File.new_for_path(filename);
                            const parent = file.get_parent();
                            if (parent) {
                                Gio.app_info_launch_default_for_uri(parent.get_uri(), null);
                            }
                        }
                    }
                } catch (e) {
                    log(`[Winbar] Error opening file location: ${e.message}`);
                }
                this.close();
            }
        );
        this._appContextMenu.add_child(openLocationItem);

        // Position the menu
        const [selfX, selfY] = this.get_transformed_position();
        const relX = x - selfX;
        const relY = y - selfY;

        // Get menu size and adjust position to stay within bounds
        this._appContextMenuScroll.show();
        const [, menuWidth] = this._appContextMenuScroll.get_preferred_width(-1);
        const [, menuHeight] = this._appContextMenuScroll.get_preferred_height(-1);
        const [selfW, selfH] = this.get_size();

        let posX = relX;
        let posY = relY;

        if (posX + menuWidth > selfW - MENU_SCREEN_PADDING_PX) {
            posX = selfW - menuWidth - MENU_SCREEN_PADDING_PX;
        }
        if (posY + menuHeight > selfH - MENU_SCREEN_PADDING_PX) {
            posY = relY - menuHeight;
        }

        this._appContextMenuScroll.set_position(posX, posY);
    }

    _getAppCategories(app) {
        // Get current categories from the app's desktop file
        try {
            const appInfo = app.get_app_info();
            if (!appInfo) return [];

            const categories = appInfo.get_categories();
            if (!categories) return [];

            // Parse categories string and filter to standard ones
            const catList = categories.split(';').filter(c => c.length > 0);
            return catList.filter(c => STANDARD_CATEGORIES.hasOwnProperty(c));
        } catch (e) {
            log(`[Winbar] Error getting categories: ${e.message}`);
            return [];
        }
    }

    _getLocalDesktopFilePath(app) {
        // Get or create the local desktop file path
        if (!app || typeof app.get_app_info !== 'function') {
            log('[Winbar] Invalid app object in _getLocalDesktopFilePath');
            return null;
        }

        const appInfo = app.get_app_info();
        if (!appInfo) return null;

        const filename = appInfo.get_filename();
        if (!filename) return null;

        const basename = GLib.path_get_basename(filename);
        const localPath = GLib.build_filenamev([
            GLib.get_home_dir(),
            '.local', 'share', 'applications',
            basename
        ]);

        return { original: filename, local: localPath, basename };
    }

    _ensureLocalDesktopFile(app) {
        // Copy system desktop file to local if needed
        const paths = this._getLocalDesktopFilePath(app);
        if (!paths) return null;

        const localFile = Gio.File.new_for_path(paths.local);

        // If local file already exists, use it
        if (localFile.query_exists(null)) {
            return paths.local;
        }

        // Ensure local applications directory exists
        const localDir = Gio.File.new_for_path(GLib.build_filenamev([
            GLib.get_home_dir(),
            '.local', 'share', 'applications'
        ]));

        try {
            if (!localDir.query_exists(null)) {
                localDir.make_directory_with_parents(null);
            }
        } catch (e) {
            log(`[Winbar] Error creating local applications dir: ${e.message}`);
            return null;
        }

        // Copy original file to local
        const originalFile = Gio.File.new_for_path(paths.original);
        try {
            originalFile.copy(localFile, Gio.FileCopyFlags.OVERWRITE, null, null);
            return paths.local;
        } catch (e) {
            log(`[Winbar] Error copying desktop file: ${e.message}`);
            return null;
        }
    }

    _readDesktopFile(path) {
        // Read and parse a desktop file
        try {
            const file = Gio.File.new_for_path(path);
            const [success, contents] = file.load_contents(null);
            if (!success) return null;

            const decoder = new TextDecoder('utf-8');
            return decoder.decode(contents);
        } catch (e) {
            log(`[Winbar] Error reading desktop file: ${e.message}`);
            return null;
        }
    }

    _writeDesktopFile(path, content) {
        // Write content to a desktop file
        try {
            const file = Gio.File.new_for_path(path);
            const outputStream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            const bytes = new TextEncoder().encode(content);
            outputStream.write_all(bytes, null);
            outputStream.close(null);
            return true;
        } catch (e) {
            log(`[Winbar] Error writing desktop file: ${e.message}`);
            return false;
        }
    }

    _modifyDesktopFileCategories(path, addCategories, removeCategories) {
        // Modify the Categories line in a desktop file
        const content = this._readDesktopFile(path);
        if (!content) return false;

        const lines = content.split('\n');
        let categoriesLine = -1;
        let currentCategories = [];

        // Find the Categories line in [Desktop Entry] section
        let inDesktopEntry = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === '[Desktop Entry]') {
                inDesktopEntry = true;
                continue;
            }
            if (line.startsWith('[') && line !== '[Desktop Entry]') {
                inDesktopEntry = false;
                continue;
            }
            if (inDesktopEntry && line.startsWith('Categories=')) {
                categoriesLine = i;
                const catString = line.substring('Categories='.length);
                currentCategories = catString.split(';').filter(c => c.length > 0);
                break;
            }
        }

        // Modify categories
        if (addCategories) {
            for (const cat of addCategories) {
                if (!currentCategories.includes(cat)) {
                    currentCategories.push(cat);
                }
            }
        }
        if (removeCategories) {
            currentCategories = currentCategories.filter(c => !removeCategories.includes(c));
        }

        // Build new categories line
        const newCategoriesLine = 'Categories=' + currentCategories.join(';') + ';';

        if (categoriesLine >= 0) {
            lines[categoriesLine] = newCategoriesLine;
        } else {
            // Insert after [Desktop Entry]
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === '[Desktop Entry]') {
                    lines.splice(i + 1, 0, newCategoriesLine);
                    break;
                }
            }
        }

        return this._writeDesktopFile(path, lines.join('\n'));
    }

    _addAppToCategory(app, category) {
        const localPath = this._ensureLocalDesktopFile(app);
        if (!localPath) {
            Main.notify(_('Winbar'), _('Could not modify application categories'));
            return;
        }

        const success = this._modifyDesktopFileCategories(localPath, [category], null);
        if (success) {
            Main.notify(_('Winbar'), _('Added to %s category').format(STANDARD_CATEGORIES[category].name));
            // Refresh categories after a short delay to let the system update
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._refreshCategories();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            Main.notify(_('Winbar'), _('Failed to add to category'));
        }
    }

    _removeAppFromCategory(app, category) {
        const localPath = this._ensureLocalDesktopFile(app);
        if (!localPath) {
            Main.notify(_('Winbar'), _('Could not modify application categories'));
            return;
        }

        const success = this._modifyDesktopFileCategories(localPath, null, [category]);
        if (success) {
            Main.notify(_('Winbar'), _('Removed from %s category').format(STANDARD_CATEGORIES[category].name));
            // Refresh categories after a short delay
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._refreshCategories();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            Main.notify(_('Winbar'), _('Failed to remove from category'));
        }
    }

    _refreshCategories() {
        // Refresh the all apps grid
        this._loadAllAppsGrid();
    }

    _hideAppContextMenu() {
        this._appContextMenuScroll.hide();
        this._appContextMenuAppId = null;
    }

    _createContextMenuItem(iconName, label, callback) {
        const button = new St.Button({
            style_class: 'winbar-start-context-menu-item',
            x_expand: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        const box = new St.BoxLayout({
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        button.set_child(box);

        box.add_child(new St.Icon({
            icon_name: iconName,
            icon_size: 16,
            style_class: 'winbar-start-context-menu-icon',
        }));

        box.add_child(new St.Label({
            text: label,
            style_class: 'winbar-start-context-menu-label',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
        }));

        button.connect('clicked', callback);
        return button;
    }

    _refreshPinnedApps() {
        // Clear existing
        this._pinnedGrid.destroy_all_children();
        this._pinnedApps = [];
        // Reload
        this._loadPinnedApps();
    }

    _buildBottomBar() {
        // Spacer to push bottom bar to bottom
        const spacer = new St.Widget({
            y_expand: true,
        });
        this._container.add_child(spacer);

        this._bottomBar = new St.BoxLayout({
            style_class: 'winbar-start-bottom-bar',
        });
        this._container.add_child(this._bottomBar);

        // User button
        this._userButton = new St.Button({
            style_class: 'winbar-start-user-button',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        this._bottomBar.add_child(this._userButton);

        const userBox = new St.BoxLayout({
            style_class: 'winbar-start-user-box',
        });
        this._userButton.set_child(userBox);

        // User avatar
        this._userAvatar = new St.Icon({
            icon_size: ICON_SIZE,
            style_class: 'winbar-start-user-avatar',
        });
        userBox.add_child(this._userAvatar);

        // Load avatar and listen for changes
        this._loadUserAvatar();
        this._setupAccountsChangeListener();

        // User name
        const userName = GLib.get_real_name() || GLib.get_user_name();
        this._userLabel = new St.Label({
            text: userName,
            style_class: 'winbar-start-user-name',
            y_align: Clutter.ActorAlign.CENTER,
        });
        userBox.add_child(this._userLabel);

        this._userButton.connect('clicked', () => {
            this.close();
            // Open user settings via gnome-control-center
            try {
                Gio.Subprocess.new(['gnome-control-center', 'users'], Gio.SubprocessFlags.NONE);
            } catch (e) {
                log('[Winbar] Failed to open user accounts panel');
            }
        });

        // Power button
        this._powerButton = new St.Button({
            style_class: 'winbar-start-power-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            child: new St.Icon({
                icon_name: 'system-shutdown-symbolic',
                icon_size: 20,
            }),
        });
        this._bottomBar.add_child(this._powerButton);

        // Power menu
        this._buildPowerMenu();
    }

    _loadUserAvatar() {
        try {
            const userManager = AccountsService.UserManager.get_default();
            const user = userManager.get_user(GLib.get_user_name());

            // Disconnect old handlers if present
            this._disconnectAvatarHandlers();

            // Try AccountsService icon path first, then fallbacks
            let avatarFile = null;
            if (user && typeof user.get_icon_file === 'function') {
                try {
                    avatarFile = user.get_icon_file();
                } catch (err) {
                    log(`[Winbar] get_icon_file error: ${err.message}`);
                    avatarFile = null;
                }
            }

            const username = GLib.get_user_name();
            const candidatePaths = [];
            if (avatarFile) candidatePaths.push(avatarFile);
            candidatePaths.push(GLib.build_filenamev(['/var/lib/AccountsService/icons', username]));
            candidatePaths.push(GLib.build_filenamev([GLib.get_home_dir(), '.face']));
            candidatePaths.push(GLib.build_filenamev([GLib.get_home_dir(), '.face.icon']));
            candidatePaths.push(GLib.build_filenamev([GLib.get_home_dir(), '.face.png']));
            candidatePaths.push(GLib.build_filenamev([GLib.get_home_dir(), '.face.jpg']));

            let found = null;
            for (const p of candidatePaths) {
                if (p && GLib.file_test(p, GLib.FileTest.EXISTS)) {
                    found = p;
                    break;
                }
            }

            if (found) {
                this._setUserAvatarFromFile(found);
                // Setup file monitor to watch for changes
                this._setupAvatarFileMonitor(found);
            } else {
                // If no file found, try to use AccountsService's GIcon (if available)
                try {
                    if (user && typeof user.get_icon === 'function') {
                        const gicon = user.get_icon();
                        if (gicon) {
                            this._setUserAvatarGIcon(gicon);
                        } else {
                            log('[Winbar] No GIcon from AccountsService user, using default avatar');
                            this._userAvatar.icon_name = 'avatar-default-symbolic';
                        }
                    } else {
                        log('[Winbar] No AccountsService user or get_icon method, using default avatar');
                        this._userAvatar.icon_name = 'avatar-default-symbolic';
                    }
                } catch (err) {
                    log(`[Winbar] get_icon fallback failed: ${err.message}`);
                    this._userAvatar.icon_name = 'avatar-default-symbolic';
                }
            }

            // Keep reference and connect to property notifications if available
            if (user && typeof user.connect === 'function') {
                try {
                    this._accountsUser = user;
                    // Listen for icon-file changes
                    this._accountsUserIconNotifyId = user.connect('notify::icon-file', () => {
                        this._scheduleAvatarReload();
                    });
                    // Listen for real-name changes
                    this._accountsUserNameNotifyId = user.connect('notify::real-name', () => {
                        this._updateUserLabel();
                    });
                } catch (e) {
                    log(`[Winbar] Failed to connect to user notify: ${e.message}`);
                    this._accountsUser = null;
                    this._accountsUserIconNotifyId = null;
                    this._accountsUserNameNotifyId = null;
                }
            }
        } catch (e) {
            log(`[Winbar] Failed to load user avatar: ${e.message}`);
            this._userAvatar.icon_name = 'avatar-default-symbolic';
        }
    }

    _updateUserLabel() {
        try {
            let userName = null;

            // Try to get from AccountsService first (most up-to-date)
            if (this._accountsUser && typeof this._accountsUser.get_real_name === 'function') {
                userName = this._accountsUser.get_real_name();
            }

            // Fallback to GLib
            if (!userName || userName.length === 0) {
                userName = GLib.get_real_name() || GLib.get_user_name();
            }

            if (this._userLabel) {
                this._userLabel.set_text(userName);
            }
        } catch (e) {
            log(`[Winbar] Failed to update user label: ${e.message}`);
        }
    }

    _setupAvatarFileMonitor(filePath) {
        // Cancel any existing monitor
        if (this._avatarFileMonitor) {
            this._avatarFileMonitor.cancel();
            this._avatarFileMonitor = null;
        }

        try {
            const file = Gio.File.new_for_path(filePath);
            this._avatarFileMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._avatarFilePath = filePath;

            this._avatarFileMonitor.connect('changed', (monitor, changedFile, otherFile, eventType) => {
                // React to file changes, creation, or attribute changes
                if (eventType === Gio.FileMonitorEvent.CHANGED ||
                    eventType === Gio.FileMonitorEvent.CREATED ||
                    eventType === Gio.FileMonitorEvent.ATTRIBUTE_CHANGED ||
                    eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT) {
                    this._scheduleAvatarReload();
                }
            });
        } catch (e) {
            log(`[Winbar] Failed to setup avatar file monitor: ${e.message}`);
        }
    }

    _scheduleAvatarReload() {
        // Debounce to avoid rapid repeated reloads
        if (this._avatarReloadTimeout) {
            GLib.source_remove(this._avatarReloadTimeout);
        }
        this._avatarReloadTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._avatarReloadTimeout = null;
            // Re-read and update the avatar
            if (this._avatarFilePath && GLib.file_test(this._avatarFilePath, GLib.FileTest.EXISTS)) {
                this._setUserAvatarFromFile(this._avatarFilePath);
            } else {
                // File was deleted, reload to find alternative or use default
                this._loadUserAvatar();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _disconnectAvatarHandlers() {
        // Disconnect file monitor
        if (this._avatarFileMonitor) {
            this._avatarFileMonitor.cancel();
            this._avatarFileMonitor = null;
        }

        // Disconnect user notify handlers
        try {
            if (this._accountsUser) {
                if (this._accountsUserIconNotifyId) {
                    this._accountsUser.disconnect(this._accountsUserIconNotifyId);
                }
                if (this._accountsUserNameNotifyId) {
                    this._accountsUser.disconnect(this._accountsUserNameNotifyId);
                }
            }
        } catch (e) {
            log(`[Winbar] Failed to disconnect previous user notify: ${e.message}`);
        }
        this._accountsUser = null;
        this._accountsUserIconNotifyId = null;
        this._accountsUserNameNotifyId = null;
    }

    _setUserAvatarFromFile(filePath) {
        try {
            // Clear the current icon first to force a refresh
            this._userAvatar.set_gicon(null);
            this._userAvatar.icon_name = null;

            // Read the file directly and create a new pixbuf-based icon
            // This bypasses GIO's file icon caching
            const file = Gio.File.new_for_path(filePath);

            // Use a bytes-based approach to avoid caching
            const [success, contents] = file.load_contents(null);
            if (success && contents.length > 0) {
                const bytes = GLib.Bytes.new(contents);
                const gicon = new Gio.BytesIcon({ bytes: bytes });

                // Set the new icon
                this._userAvatar.set_gicon(gicon);

                // Force visual update
                if (typeof this._userAvatar.queue_relayout === 'function')
                    this._userAvatar.queue_relayout();
                if (typeof this._userAvatar.queue_redraw === 'function')
                    this._userAvatar.queue_redraw();
            } else {
                log('[Winbar] Failed to load avatar file contents');
                this._userAvatar.icon_name = 'avatar-default-symbolic';
            }
        } catch (err) {
            log(`[Winbar] Failed to set avatar from file: ${err.message}`);
            // Fallback to FileIcon method
            try {
                const file = Gio.File.new_for_path(filePath);
                const gicon = new Gio.FileIcon({ file: file });
                this._setUserAvatarGIcon(gicon);
            } catch (fallbackErr) {
                log(`[Winbar] Fallback also failed: ${fallbackErr.message}`);
                this._userAvatar.icon_name = 'avatar-default-symbolic';
            }
        }
    }

    _setUserAvatarGIcon(gicon) {
        try {
            // Clear previous gicon to avoid caching issues, then set new one
            this._userAvatar.set_gicon(null);
            this._userAvatar.icon_name = null;

            // Small delay to ensure the clear takes effect
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                try {
                    this._userAvatar.set_gicon(gicon);

                    // Force redraw/relayout to ensure changes are visible immediately
                    if (typeof this._userAvatar.queue_relayout === 'function')
                        this._userAvatar.queue_relayout();
                    if (typeof this._userAvatar.queue_redraw === 'function')
                        this._userAvatar.queue_redraw();
                } catch (err) {
                    log(`[Winbar] Failed to set gicon in idle: ${err.message}`);
                    this._userAvatar.icon_name = 'avatar-default-symbolic';
                }
                return GLib.SOURCE_REMOVE;
            });
        } catch (err) {
            log(`[Winbar] Failed to apply avatar gicon: ${err.message}`);
            this._userAvatar.icon_name = 'avatar-default-symbolic';
        }
    }

    _setupAccountsChangeListener() {
        // If already subscribed, skip
        if (this._accountsSignalId) return;

        try {
            this._accountsSignalId = Gio.DBus.system.signal_subscribe(
                /* sender_name */ null,
                /* interface_name */ 'org.freedesktop.Accounts',
                /* member */ 'UserChanged',
                /* object_path */ '/org/freedesktop/Accounts',
                /* arg0 */ null,
                Gio.DBusSignalFlags.NONE,
                (connection, sender, object_path, interface_name, signal_name, parameters) => {
                    try {
                        // Refresh avatar when AccountsService notifies user changes
                        this._loadUserAvatar();
                    } catch (e) {
                        log(`[Winbar] Accounts signal handler error: ${e.message}`);
                    }
                }
            );
        } catch (e) {
            log(`[Winbar] Could not subscribe to AccountsService signals: ${e.message}`);
        }
    }

    _buildPowerMenu() {
        this._powerMenu = new St.BoxLayout({
            style_class: 'winbar-start-power-menu',
            vertical: true,
            visible: false,
        });
        this.add_child(this._powerMenu);

        const powerItems = [
            { icon: 'system-lock-screen-symbolic', label: _('Lock'), action: 'lock' },
            { icon: 'system-log-out-symbolic', label: _('Sign out'), action: 'logout' },
            { icon: 'system-reboot-symbolic', label: _('Restart'), action: 'restart' },
            { icon: 'system-shutdown-symbolic', label: _('Shut down'), action: 'shutdown' },
        ];

        for (const item of powerItems) {
            const button = new St.Button({
                style_class: 'winbar-start-power-menu-item',
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_expand: true,
            });

            const box = new St.BoxLayout({
                x_expand: true,
            });
            button.set_child(box);

            box.add_child(new St.Icon({
                icon_name: item.icon,
                icon_size: 18,
                style_class: 'winbar-start-power-menu-icon',
            }));

            box.add_child(new St.Label({
                text: item.label,
                style_class: 'winbar-start-power-menu-label',
                y_align: Clutter.ActorAlign.CENTER,
            }));

            button.connect('clicked', () => {
                this._executePowerAction(item.action);
            });

            this._powerMenu.add_child(button);
        }

        // Toggle power menu on power button click
        this._powerButton.connect('clicked', () => {
            this._togglePowerMenu();
        });
    }

    _togglePowerMenu() {
        if (this._powerMenu.visible) {
            this._powerMenu.hide();
        } else {
            // Position the power menu above the power button
            const [buttonX, buttonY] = this._powerButton.get_transformed_position();
            const [buttonW, buttonH] = this._powerButton.get_size();

            // Get menu size properly
            const [, menuNatWidth] = this._powerMenu.get_preferred_width(-1);
            const [, menuNatHeight] = this._powerMenu.get_preferred_height(-1);

            // Convert to relative position within the StartMenu
            const [selfX, selfY] = this.get_transformed_position();
            const relX = buttonX - selfX + buttonW - menuNatWidth;
            const relY = buttonY - selfY - menuNatHeight - 8;

            this._powerMenu.set_position(relX, relY);
            this._powerMenu.show();
        }
    }

    _executePowerAction(action) {
        this.close();

        switch (action) {
            case 'lock':
                Main.screenShield.lock(true);
                break;
            case 'logout':
                this._systemActionsExec('logout');
                break;
            case 'restart':
                this._systemActionsExec('restart');
                break;
            case 'shutdown':
                this._systemActionsExec('power-off');
                break;
        }
    }

    _systemActionsExec(action) {
        const systemActions = SystemActions.getDefault();

        switch (action) {
            case 'logout':
                systemActions.activateLogout();
                break;
            case 'restart':
                systemActions.activateRestart();
                break;
            case 'power-off':
                systemActions.activatePowerOff();
                break;
        }
    }

    _loadPinnedApps() {
        // Use Start Menu specific pinned apps from settings
        const pinnedAppIds = this._settings.get_strv('start-menu-pinned-apps');
        const appSystem = Shell.AppSystem.get_default();

        // Clear existing grid
        this._pinnedGrid.destroy_all_children();

        const layout = this._pinnedGrid.layout_manager;
        let col = 0;
        let row = 0;
        const maxCols = 6;

        this._pinnedApps = [];
        this._pinnedButtons = [];

        for (let i = 0; i < pinnedAppIds.length; i++) {
            const appId = pinnedAppIds[i];
            const app = appSystem.lookup_app(appId);
            if (app) {
                const appButton = this._createPinnedAppButton(app, i);
                layout.attach(appButton, col, row, 1, 1);
                this._pinnedApps.push({ app, button: appButton, index: i });
                this._pinnedButtons.push(appButton);

                col++;
                if (col >= maxCols) {
                    col = 0;
                    row++;
                }
            }
        }
    }

    _createPinnedAppButton(app, index) {
        const button = new St.Button({
            style_class: 'winbar-start-app-button',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        button.set_child(box);

        const icon = new St.Icon({
            gicon: app.get_icon(),
            icon_size: 40,
            style_class: 'winbar-start-app-icon',
        });
        box.add_child(icon);

        const name = app.get_name();
        const label = new St.Label({
            text: name.length > 12 ? name.substring(0, 10) + '...' : name,
            style_class: 'winbar-start-app-label',
        });
        box.add_child(label);

        // Store app ID and index for drag/drop
        const appId = app.get_id();
        button._appId = appId;
        button._pinnedIndex = index;

        // Drag and drop state
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragThreshold = 10;
        let originalOpacity = 255;

        button.connect('button-press-event', (actor, event) => {
            const buttonNum = event.get_button();
            if (buttonNum === 3) {
                // Right-click - show context menu
                const [x, y] = event.get_coords();
                const freshApp = Shell.AppSystem.get_default().lookup_app(appId);
                if (freshApp) {
                    this._showAppContextMenu(freshApp, x, y);
                }
                return Clutter.EVENT_STOP;
            }
            if (buttonNum === 1) {
                // Left-click - start potential drag
                [dragStartX, dragStartY] = event.get_coords();
                this._dragSourceButton = button;
                this._dragStarted = false;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        button.connect('motion-event', (actor, event) => {
            if (this._dragSourceButton !== button) return Clutter.EVENT_PROPAGATE;

            const [x, y] = event.get_coords();
            const dx = Math.abs(x - dragStartX);
            const dy = Math.abs(y - dragStartY);

            if (!this._dragStarted && (dx > dragThreshold || dy > dragThreshold)) {
                // Start dragging
                this._dragStarted = true;
                isDragging = true;
                originalOpacity = button.opacity;
                button.opacity = 64;
                button.add_style_class_name('dragging');

                // Create a floating clone that follows the cursor
                this._createDragClone(button, x, y);
            }

            if (this._dragStarted) {
                // Update clone position to follow cursor
                this._updateDragClone(x, y);

                // Find which button we're hovering over
                this._updateDropTarget(x, y);
            }

            return Clutter.EVENT_PROPAGATE;
        });

        button.connect('button-release-event', (actor, event) => {
            if (this._dragSourceButton !== button) return Clutter.EVENT_PROPAGATE;

            if (this._dragStarted && isDragging) {
                // Complete the drag
                button.opacity = originalOpacity;
                button.remove_style_class_name('dragging');

                // Remove the drag clone
                this._destroyDragClone();

                if (this._dropTargetIndex !== null && this._dropTargetIndex !== button._pinnedIndex) {
                    this._reorderPinnedApp(button._pinnedIndex, this._dropTargetIndex);
                }

                this._clearDropIndicators();
                isDragging = false;

                // Reset drag state
                this._dragSourceButton = null;
                this._dragStarted = false;
                this._dropTargetIndex = null;

                return Clutter.EVENT_STOP;
            } else if (!this._dragStarted) {
                // It was a click, not a drag - reset state and let clicked signal handle it
                this._dragSourceButton = null;
                this._dragStarted = false;
                this._dropTargetIndex = null;

                // Don't stop the event - let it propagate so clicked signal fires
                return Clutter.EVENT_PROPAGATE;
            }

            // Cleanup for any other case
            this._dragSourceButton = null;
            this._dragStarted = false;
            this._dropTargetIndex = null;

            return Clutter.EVENT_PROPAGATE;
        });

        button.connect('leave-event', () => {
            if (this._dragStarted && this._dragSourceButton === button) {
                // Continue tracking even when leaving the button
                return Clutter.EVENT_PROPAGATE;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Handle clicks (only fires if not dragging due to button-release-event logic)
        button.connect('clicked', () => {
            if (this._appContextMenuScroll.visible) return;
            this.close();
            const freshApp = Shell.AppSystem.get_default().lookup_app(appId);
            if (freshApp) {
                if (typeof freshApp.open_new_window === 'function') {
                    freshApp.open_new_window(-1);
                } else {
                    freshApp.activate();
                }
            }
        });

        return button;
    }

    _updateDropTarget(x, y) {
        // Find which pinned button the cursor is over
        let targetIndex = null;

        for (let i = 0; i < this._pinnedButtons.length; i++) {
            const btn = this._pinnedButtons[i];
            if (btn === this._dragSourceButton) continue;

            const [btnX, btnY] = btn.get_transformed_position();
            const [btnW, btnH] = btn.get_size();

            if (x >= btnX && x <= btnX + btnW && y >= btnY && y <= btnY + btnH) {
                targetIndex = i;
                break;
            }
        }

        // Update visual indicators
        this._clearDropIndicators();

        if (targetIndex !== null && targetIndex !== this._dropTargetIndex) {
            this._pinnedButtons[targetIndex].add_style_class_name('drop-target');
        }

        this._dropTargetIndex = targetIndex;
    }

    _clearDropIndicators() {
        for (const btn of this._pinnedButtons) {
            btn.remove_style_class_name('drop-target');
        }
    }

    _reorderPinnedApp(fromIndex, toIndex) {
        const pinnedAppIds = this._settings.get_strv('start-menu-pinned-apps');

        if (fromIndex < 0 || fromIndex >= pinnedAppIds.length ||
            toIndex < 0 || toIndex >= pinnedAppIds.length) {
            return;
        }

        // Remove from old position and insert at new position
        const [movedApp] = pinnedAppIds.splice(fromIndex, 1);
        pinnedAppIds.splice(toIndex, 0, movedApp);

        // Save to settings (this will trigger a refresh via the settings change handler)
        this._settings.set_strv('start-menu-pinned-apps', pinnedAppIds);
    }

    _createDragClone(button, x, y) {
        // Destroy any existing clone
        this._destroyDragClone();

        // Create a simple clone with just the icon
        this._dragClone = new St.BoxLayout({
            style_class: 'winbar-drag-clone',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Get the app icon from the button
        const originalBox = button.get_child();
        if (originalBox) {
            const origIcon = originalBox.get_first_child();
            if (origIcon && origIcon.gicon) {
                const iconClone = new St.Icon({
                    gicon: origIcon.gicon,
                    icon_size: 40,
                });
                this._dragClone.add_child(iconClone);
            }

            // Clone label
            const children = originalBox.get_children();
            if (children.length > 1) {
                const origLabel = children[1];
                if (origLabel && origLabel.text) {
                    const labelClone = new St.Label({
                        text: origLabel.text,
                        style: 'font-size: 11px; color: #ffffff; text-align: center; margin-top: 4px;',
                    });
                    this._dragClone.add_child(labelClone);
                }
            }
        }

        // Add to chrome for overlay rendering
        Main.layoutManager.addChrome(this._dragClone, {
            affectsInputRegion: false,
        });

        // Position at cursor
        this._updateDragClone(x, y);
    }

    _updateDragClone(x, y) {
        if (!this._dragClone) return;

        // Center the clone on the cursor
        const [cloneW, cloneH] = this._dragClone.get_size();
        this._dragClone.set_position(
            Math.round(x - cloneW / 2),
            Math.round(y - cloneH / 2)
        );
    }

    _destroyDragClone() {
        if (this._dragClone) {
            try {
                Main.layoutManager.removeChrome(this._dragClone);
            } catch (e) {
                // Ignore
            }
            this._dragClone.destroy();
            this._dragClone = null;
        }
    }

    /**
     * Clean up any active drag operation state
     * Called when menu closes to prevent stuck drag state
     */
    _cleanupDragState() {
        // Restore the dragged button's appearance if it exists
        if (this._dragSourceButton) {
            try {
                this._dragSourceButton.opacity = 255;
                this._dragSourceButton.remove_style_class_name('dragging');
            } catch (e) {
                // Button may have been destroyed
            }
            this._dragSourceButton = null;
        }

        // Destroy the drag clone (floating icon following cursor)
        this._destroyDragClone();

        // Clear all drop indicators
        this._clearDropIndicators();

        // Reset drag state flags
        this._dragStarted = false;
        this._dropTargetIndex = null;
    }

    _loadRecentFiles() {
        // Clear existing items
        this._recommendedBox.destroy_all_children();

        const appSystem = Shell.AppSystem.get_default();

        // Try multiple sources for recent/recommended apps
        let recentApps = [];

        // Source 1: Try Shell.AppUsage for most used apps
        try {
            const usage = Shell.AppUsage.get_default();
            const mostUsed = usage.get_most_used();

            for (const appOrId of mostUsed) {
                if (recentApps.length >= 6) break;

                let app = appOrId;
                // Handle case where it might return an app ID string
                if (typeof appOrId === 'string') {
                    app = appSystem.lookup_app(appOrId);
                }

                if (app && typeof app.get_name === 'function') {
                    // Check should_show if available
                    if (typeof app.should_show === 'function') {
                        if (app.should_show()) {
                            recentApps.push(app);
                        }
                    } else {
                        recentApps.push(app);
                    }
                }
            }
        } catch (e) {
            log(`[Winbar] Error getting most used apps: ${e.message}`);
        }

        // Source 2: Try favorites if we don't have enough
        if (recentApps.length < 6) {
            try {
                const favIds = global.settings.get_strv('favorite-apps');
                for (const appId of favIds) {
                    if (recentApps.length >= 6) break;

                    const app = appSystem.lookup_app(appId);
                    if (app && !recentApps.includes(app)) {
                        if (typeof app.should_show !== 'function' || app.should_show()) {
                            recentApps.push(app);
                        }
                    }
                }
            } catch (e) {
                log(`[Winbar] Error getting favorite apps: ${e.message}`);
            }
        }

        // Source 3: Fallback to installed apps if still not enough
        if (recentApps.length < 6) {
            try {
                const installed = appSystem.get_installed();
                for (const app of installed) {
                    if (recentApps.length >= 6) break;

                    if (app && !recentApps.includes(app)) {
                        if (typeof app.should_show === 'function' && app.should_show()) {
                            recentApps.push(app);
                        }
                    }
                }
            } catch (e) {
                log(`[Winbar] Error getting installed apps: ${e.message}`);
            }
        }

        const layout = this._recommendedBox.layout_manager;
        let col = 0;
        let row = 0;
        const maxCols = 2;

        let count = 0;
        for (const app of recentApps) {
            const itemWidget = this._createRecentAppItem(app);
            if (itemWidget) {
                layout.attach(itemWidget, col, row, 1, 1);
                count++;

                col++;
                if (col >= maxCols) {
                    col = 0;
                    row++;
                }
            }
        }

        // If no recent items, show placeholder
        if (count === 0) {
            const placeholder = new St.Label({
                text: _('No recent items'),
                style_class: 'winbar-start-recommended-placeholder',
            });
            layout.attach(placeholder, 0, 0, 2, 1);
        }
    }

    _createRecentAppItem(app) {
        try {
            const button = new St.Button({
                style_class: 'winbar-start-recommended-item',
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            const box = new St.BoxLayout({
                x_expand: true,
            });
            button.set_child(box);

            // Icon
            const icon = new St.Icon({
                gicon: app.get_icon(),
                icon_size: 36,
                style_class: 'winbar-start-recommended-icon',
            });
            box.add_child(icon);

            // Info box
            const infoBox = new St.BoxLayout({
                vertical: true,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            box.add_child(infoBox);

            // Name
            const name = app.get_name();
            infoBox.add_child(new St.Label({
                text: name.length > 22 ? name.substring(0, 19) + '...' : name,
                style_class: 'winbar-start-recommended-name',
            }));

            // Description instead of time
            const description = app.get_description() || _('Application');
            infoBox.add_child(new St.Label({
                text: description.length > 28 ? description.substring(0, 25) + '...' : description,
                style_class: 'winbar-start-recommended-time',
            }));

            // Store app ID for context menu
            const appId = app.get_id();
            button._appId = appId;

            // Right-click for context menu
            button.connect('button-press-event', (actor, event) => {
                const buttonNum = event.get_button();
                if (buttonNum === 3) {
                    const [x, y] = event.get_coords();
                    const freshApp = Shell.AppSystem.get_default().lookup_app(appId);
                    if (freshApp) {
                        this._showAppContextMenu(freshApp, x, y);
                    }
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            button.connect('clicked', () => {
                if (this._appContextMenuScroll.visible) return;
                this.close();
                const freshApp = Shell.AppSystem.get_default().lookup_app(appId);
                if (freshApp) {
                    if (typeof freshApp.open_new_window === 'function') {
                        freshApp.open_new_window(-1);
                    } else {
                        freshApp.activate();
                    }
                }
            });

            return button;
        } catch (e) {
            return null;
        }
    }

    _formatRelativeTime(timestamp) {
        const now = GLib.DateTime.new_now_local();
        const then = GLib.DateTime.new_from_unix_local(timestamp);
        const diff = now.difference(then) / 1000000; // Convert to seconds

        if (diff < 60) return _('Just now');
        if (diff < 3600) return _('%d min ago').format(Math.floor(diff / 60));
        if (diff < 86400) return _('%d hours ago').format(Math.floor(diff / 3600));
        if (diff < 604800) return _('%d days ago').format(Math.floor(diff / 86400));
        return then.format('%b %d');
    }

    _loadAllAppsGrid() {
        // Clear existing grid and buttons list
        this._allAppsGrid.destroy_all_children();
        this._allAppsButtons = [];

        const appSystem = Shell.AppSystem.get_default();
        let apps = appSystem.get_installed().filter(app => {
            try {
                return app && typeof app.should_show === 'function' && app.should_show();
            } catch (e) {
                return false;
            }
        });

        // Sort based on current sort setting
        switch (this._currentSort) {
            case 'az':
                apps.sort((a, b) => {
                    try {
                        return a.get_name().localeCompare(b.get_name());
                    } catch (e) {
                        return 0;
                    }
                });
                break;
            case 'za':
                apps.sort((a, b) => {
                    try {
                        return b.get_name().localeCompare(a.get_name());
                    } catch (e) {
                        return 0;
                    }
                });
                break;
            case 'recent':
                // Sort by most used (using Shell.AppUsage if available)
                try {
                    const usage = Shell.AppUsage.get_default();
                    apps.sort((a, b) => {
                        try {
                            const scoreA = usage.get_score(a.get_id()) || 0;
                            const scoreB = usage.get_score(b.get_id()) || 0;
                            return scoreB - scoreA;
                        } catch (e) {
                            return 0;
                        }
                    });
                } catch (e) {
                    // Fall back to alphabetical
                    apps.sort((a, b) => a.get_name().localeCompare(b.get_name()));
                }
                break;
            case 'category':
                // Sort by category, then alphabetically within category
                apps.sort((a, b) => {
                    try {
                        const catA = this._getAppPrimaryCategory(a);
                        const catB = this._getAppPrimaryCategory(b);
                        if (catA !== catB) {
                            return catA.localeCompare(catB);
                        }
                        return a.get_name().localeCompare(b.get_name());
                    } catch (e) {
                        return 0;
                    }
                });
                break;
        }

        // Create grid items
        const layout = this._allAppsGrid.layout_manager;
        const maxCols = 6;
        let col = 0;
        let row = 0;

        for (const app of apps) {
            try {
                const button = this._createAppButton(app, true);
                layout.attach(button, col, row, 1, 1);

                // Store for search filtering
                this._allAppsButtons.push({ app, button });

                col++;
                if (col >= maxCols) {
                    col = 0;
                    row++;
                }
            } catch (e) {
                // Skip problematic apps
            }
        }
    }

    _getAppPrimaryCategory(app) {
        try {
            const appInfo = app.get_app_info?.();
            const categories = appInfo?.get_categories?.()?.split(';') || [];

            for (const cat of categories) {
                if (cat.includes('Office') || cat.includes('TextEditor')) return 'Office';
                if (cat.includes('Development') || cat.includes('IDE')) return 'Development';
                if (cat.includes('Utility') || cat.includes('Settings')) return 'Utilities';
                if (cat.includes('Graphics') || cat.includes('Photography')) return 'Graphics';
                if (cat.includes('Network') || cat.includes('WebBrowser') || cat.includes('Email')) return 'Internet';
                if (cat.includes('Audio') || cat.includes('Video') || cat.includes('Player')) return 'Multimedia';
                if (cat.includes('Game')) return 'Games';
                if (cat.includes('System') || cat.includes('Monitor')) return 'System';
            }
            return 'Other';
        } catch (e) {
            return 'Other';
        }
    }

    _createAppButton(app, showLabel = true) {
        const button = new St.Button({
            style_class: 'winbar-start-app-button',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        button.set_child(box);

        const icon = new St.Icon({
            gicon: app.get_icon(),
            icon_size: 40,
            style_class: 'winbar-start-app-icon',
        });
        box.add_child(icon);

        if (showLabel) {
            const name = app.get_name();
            const label = new St.Label({
                text: name.length > 12 ? name.substring(0, 10) + '...' : name,
                style_class: 'winbar-start-app-label',
            });
            box.add_child(label);
        }

        // Store app ID for later lookup
        const appId = app.get_id();

        button.connect('button-press-event', (actor, event) => {
            const buttonNum = event.get_button();
            if (buttonNum === 3) {
                // Right-click - show context menu
                const [x, y] = event.get_coords();
                // Look up fresh app reference
                const freshApp = Shell.AppSystem.get_default().lookup_app(appId);
                if (freshApp) {
                    this._showAppContextMenu(freshApp, x, y);
                }
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        button.connect('clicked', () => {
            if (this._appContextMenuScroll.visible) return;
            this.close();
            // Look up fresh app reference and activate
            const freshApp = Shell.AppSystem.get_default().lookup_app(appId);
            if (freshApp) {
                // Open new window if possible, otherwise activate
                if (typeof freshApp.open_new_window === 'function') {
                    freshApp.open_new_window(-1);
                } else {
                    freshApp.activate();
                }
            }
        });

        button._appId = appId;
        return button;
    }

    // ========== Search Learning System ==========

    _loadSearchLearning() {
        try {
            const data = this._settings.get_string('search-learning-data');
            this._searchLearning = JSON.parse(data || '{}');
        } catch (e) {
            this._searchLearning = {};
        }
    }

    _saveSearchLearning() {
        try {
            const data = JSON.stringify(this._searchLearning);
            this._settings.set_string('search-learning-data', data);
        } catch (e) {
            log(`[Winbar] Failed to save search learning: ${e.message}`);
        }
    }

    _recordSearchSelection(query, appId) {
        if (!query || query.length < 2 || !appId) return;

        // Normalize the query
        const normalizedQuery = query.toLowerCase().trim();

        // Initialize if needed
        if (!this._searchLearning[normalizedQuery]) {
            this._searchLearning[normalizedQuery] = {};
        }

        // Increment the count for this app
        if (!this._searchLearning[normalizedQuery][appId]) {
            this._searchLearning[normalizedQuery][appId] = 0;
        }
        this._searchLearning[normalizedQuery][appId]++;

        // Also learn from prefix queries (e.g., "fi" -> "fir" -> "fire" -> "firef" -> "firefox")
        // This helps with typing patterns
        for (let i = 2; i < normalizedQuery.length; i++) {
            const prefix = normalizedQuery.substring(0, i);
            if (!this._searchLearning[prefix]) {
                this._searchLearning[prefix] = {};
            }
            if (!this._searchLearning[prefix][appId]) {
                this._searchLearning[prefix][appId] = 0;
            }
            // Give less weight to prefix matches
            this._searchLearning[prefix][appId] += 0.5;
        }

        this._saveSearchLearning();
    }

    _getLearnedScore(query, appId) {
        const normalizedQuery = query.toLowerCase().trim();
        if (this._searchLearning[normalizedQuery] && this._searchLearning[normalizedQuery][appId]) {
            // Cap the learning bonus at 50 points, scale logarithmically
            const count = this._searchLearning[normalizedQuery][appId];
            return Math.min(50, Math.log2(count + 1) * 15);
        }
        return 0;
    }

    // ========== Search Synonyms/Translations ==========

    _initSearchSynonyms() {
        // Load synonyms from settings, fall back to built-in defaults
        try {
            const data = this._settings.get_string('search-synonyms');
            if (data) {
                this._searchSynonyms = JSON.parse(data);
            } else {
                this._searchSynonyms = { ...DEFAULT_SEARCH_SYNONYMS };
            }
        } catch (e) {
            this._searchSynonyms = { ...DEFAULT_SEARCH_SYNONYMS };
        }

        // Build reverse mapping: app keyword -> synonyms that match it
        this._appToSynonyms = {};
        for (const [term, apps] of Object.entries(this._searchSynonyms)) {
            for (const app of apps) {
                if (!this._appToSynonyms[app.toLowerCase()]) {
                    this._appToSynonyms[app.toLowerCase()] = [];
                }
                this._appToSynonyms[app.toLowerCase()].push(term);
            }
        }

        // Listen for runtime changes from preferences
        if (!this._synonymsChangedId) {
            this._synonymsChangedId = this._settings.connect('changed::search-synonyms', () => {
                this._initSearchSynonyms();
            });
        }
    }

    _getSynonymMatches(query) {
        const normalizedQuery = query.toLowerCase().trim();
        const matches = new Set();

        // Check if query matches any synonym key
        for (const [term, apps] of Object.entries(this._searchSynonyms)) {
            if (term.startsWith(normalizedQuery) || normalizedQuery.startsWith(term)) {
                apps.forEach(app => matches.add(app.toLowerCase()));
            }
        }

        return matches;
    }

    // ========== Fuzzy Matching ==========

    _fuzzyMatch(query, text) {
        // Simple fuzzy matching: all characters in query must appear in order in text
        const queryLower = query.toLowerCase();
        const textLower = text.toLowerCase();

        let queryIndex = 0;
        let consecutiveMatches = 0;
        let maxConsecutive = 0;

        for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
            if (textLower[i] === queryLower[queryIndex]) {
                queryIndex++;
                consecutiveMatches++;
                maxConsecutive = Math.max(maxConsecutive, consecutiveMatches);
            } else {
                consecutiveMatches = 0;
            }
        }

        // Return match score if all query chars were found
        if (queryIndex === queryLower.length) {
            // Score based on: length similarity, consecutive matches, and position
            const lengthRatio = queryLower.length / textLower.length;
            const consecutiveRatio = maxConsecutive / queryLower.length;
            return (lengthRatio * 0.3 + consecutiveRatio * 0.7) * 30;
        }

        return 0;
    }

    _wordStartsWithMatch(query, text) {
        // Check if any word in text starts with query
        const queryLower = query.toLowerCase();
        const words = text.toLowerCase().split(/[\s\-_\.]+/);

        for (const word of words) {
            if (word.startsWith(queryLower)) {
                return true;
            }
        }
        return false;
    }

    // ========== Search Execution ==========

    _onSearchTextChanged() {
        const text = this._searchEntry.get_text().toLowerCase().trim();

        // Store current query for learning
        this._currentSearchQuery = text;

        if (text === '') {
            // Reset to normal view - hide search results, show main scroll
            this._searchResults.hide();
            this._mainScroll.show();
            this._clearSearchResults();
            return;
        }

        // Show search results view, hide main scroll
        this._mainScroll.hide();
        this._searchResults.show();

        // Clear previous results
        this._clearSearchResults();

        // Get synonym matches for this query
        const synonymMatches = this._getSynonymMatches(text);

        // Get all apps and filter
        const appSystem = Shell.AppSystem.get_default();
        const allApps = appSystem.get_installed().filter(app => {
            try {
                return app.should_show();
            } catch (e) {
                return false;
            }
        });

        // Score and filter apps based on search text
        const appResults = [];
        for (const app of allApps) {
            try {
                const name = app.get_name();
                const nameLower = name.toLowerCase();
                const id = app.get_id().toLowerCase();
                const description = (app.get_description() || '').toLowerCase();
                const appId = app.get_id();

                let score = 0;

                // 1. Exact name match gets highest score
                if (nameLower === text) {
                    score = 100;
                }
                // 2. Name starts with query
                else if (nameLower.startsWith(text)) {
                    score = 85;
                }
                // 3. Any word in name starts with query (e.g., "studio" matches "Visual Studio Code")
                else if (this._wordStartsWithMatch(text, name)) {
                    score = 75;
                }
                // 4. Name contains query
                else if (nameLower.includes(text)) {
                    score = 65;
                }
                // 5. Synonym match (e.g., "terminal" matches "Konsole")
                else if (synonymMatches.size > 0) {
                    // Check if app name or id matches any synonym target
                    for (const synonym of synonymMatches) {
                        if (nameLower.includes(synonym) || id.includes(synonym)) {
                            score = 60;
                            break;
                        }
                    }
                }
                // 6. ID contains query (e.g., "firefox" in "org.mozilla.firefox.desktop")
                if (score === 0 && id.includes(text)) {
                    score = 50;
                }
                // 7. Fuzzy match on name
                if (score === 0) {
                    const fuzzyScore = this._fuzzyMatch(text, name);
                    if (fuzzyScore > 10) {
                        score = Math.min(45, fuzzyScore);
                    }
                }
                // 8. Description contains query
                if (score === 0 && description.includes(text)) {
                    score = 25;
                }
                // 9. Check app's reverse synonym mapping
                if (score === 0 && this._appToSynonyms[nameLower]) {
                    for (const synonym of this._appToSynonyms[nameLower]) {
                        if (synonym.includes(text) || text.includes(synonym)) {
                            score = 55;
                            break;
                        }
                    }
                }

                // Add learning bonus
                if (score > 0) {
                    const learnedBonus = this._getLearnedScore(text, appId);
                    score += learnedBonus;

                    appResults.push({ type: 'app', app, score, name: app.get_name() });
                }
            } catch (e) {
                // Skip apps that error
            }
        }

        // Search for settings panels (if enabled)
        const searchSettingsPanels = this._settings.get_boolean('search-settings-panels');
        const settingsResults = searchSettingsPanels ? this._searchSettings(text) : [];

        // Search for documents in configured folders (if enabled)
        const searchDocumentsEnabled = this._settings.get_boolean('search-documents');
        const documentResults = searchDocumentsEnabled ? this._searchDocuments(text) : [];

        // Combine all results
        const allResults = [...appResults, ...settingsResults, ...documentResults];

        // Sort by score (highest first), then alphabetically
        allResults.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.name.localeCompare(b.name);
        });

        // Limit results based on settings
        const maxResults = this._settings.get_int('search-max-results');
        const limitedResults = allResults.slice(0, maxResults);

        // Create result items based on type
        for (const result of limitedResults) {
            let resultItem;
            if (result.type === 'app') {
                resultItem = this._createSearchResultItem(result.app);
            } else if (result.type === 'setting') {
                resultItem = this._createSettingResultItem(result);
            } else if (result.type === 'document') {
                resultItem = this._createDocumentResultItem(result);
            }
            if (resultItem) {
                this._searchResultsBox.add_child(resultItem);
                this._searchResultButtons.push(resultItem);
            }
        }

        // Show "no results" message if empty
        if (limitedResults.length === 0) {
            const noResults = new St.Label({
                text: _('No results found'),
                style_class: 'winbar-search-no-results',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._searchResultsBox.add_child(noResults);
        } else {
            // Auto-select first result
            this._selectSearchResult(0);
        }
    }

    _searchSettings(text) {
        // Common GNOME Settings panels with their keywords
        const settingsPanels = [
            { name: 'Wi-Fi', panel: 'wifi', keywords: ['wifi', 'wireless', 'network', 'internet', 'wi-fi'], icon: 'network-wireless-symbolic' },
            { name: 'Bluetooth', panel: 'bluetooth', keywords: ['bluetooth', 'wireless', 'devices'], icon: 'bluetooth-symbolic' },
            { name: 'Network', panel: 'network', keywords: ['network', 'ethernet', 'vpn', 'proxy', 'internet'], icon: 'network-wired-symbolic' },
            { name: 'Background', panel: 'background', keywords: ['background', 'wallpaper', 'desktop'], icon: 'preferences-desktop-wallpaper-symbolic' },
            { name: 'Appearance', panel: 'appearance', keywords: ['appearance', 'theme', 'dark', 'light', 'style'], icon: 'preferences-desktop-appearance-symbolic' },
            { name: 'Notifications', panel: 'notifications', keywords: ['notifications', 'alerts', 'do not disturb'], icon: 'preferences-system-notifications-symbolic' },
            { name: 'Search', panel: 'search', keywords: ['search', 'find'], icon: 'preferences-system-search-symbolic' },
            { name: 'Multitasking', panel: 'multitasking', keywords: ['multitasking', 'workspaces', 'windows'], icon: 'preferences-system-multitasking-symbolic' },
            { name: 'Applications', panel: 'applications', keywords: ['applications', 'apps', 'default'], icon: 'preferences-desktop-apps-symbolic' },
            { name: 'Privacy', panel: 'privacy', keywords: ['privacy', 'security', 'location', 'screen lock'], icon: 'preferences-system-privacy-symbolic' },
            { name: 'Online Accounts', panel: 'online-accounts', keywords: ['accounts', 'online', 'google', 'microsoft', 'cloud'], icon: 'goa-panel-symbolic' },
            { name: 'Sharing', panel: 'sharing', keywords: ['sharing', 'remote', 'ssh', 'media'], icon: 'preferences-system-sharing-symbolic' },
            { name: 'Sound', panel: 'sound', keywords: ['sound', 'audio', 'volume', 'speaker', 'microphone'], icon: 'audio-speakers-symbolic' },
            { name: 'Power', panel: 'power', keywords: ['power', 'battery', 'energy', 'suspend', 'sleep'], icon: 'preferences-system-power-symbolic' },
            { name: 'Displays', panel: 'display', keywords: ['display', 'monitor', 'screen', 'resolution', 'brightness'], icon: 'preferences-desktop-display-symbolic' },
            { name: 'Mouse & Touchpad', panel: 'mouse', keywords: ['mouse', 'touchpad', 'pointer', 'cursor', 'click'], icon: 'input-mouse-symbolic' },
            { name: 'Keyboard', panel: 'keyboard', keywords: ['keyboard', 'shortcuts', 'input', 'typing'], icon: 'input-keyboard-symbolic' },
            { name: 'Printers', panel: 'printers', keywords: ['printer', 'print', 'scanner'], icon: 'printer-symbolic' },
            { name: 'Removable Media', panel: 'removable-media', keywords: ['removable', 'media', 'usb', 'cd', 'dvd'], icon: 'drive-removable-media-symbolic' },
            { name: 'Color', panel: 'color', keywords: ['color', 'calibration', 'profile'], icon: 'preferences-color-symbolic' },
            { name: 'Region & Language', panel: 'region', keywords: ['region', 'language', 'locale', 'format'], icon: 'preferences-desktop-locale-symbolic' },
            { name: 'Accessibility', panel: 'universal-access', keywords: ['accessibility', 'universal', 'access', 'vision', 'hearing'], icon: 'preferences-desktop-accessibility-symbolic' },
            { name: 'Users', panel: 'user-accounts', keywords: ['users', 'accounts', 'password', 'login'], icon: 'system-users-symbolic' },
            { name: 'Default Applications', panel: 'default-apps', keywords: ['default', 'applications', 'browser', 'email', 'music'], icon: 'preferences-desktop-default-applications-symbolic' },
            { name: 'Date & Time', panel: 'datetime', keywords: ['date', 'time', 'clock', 'timezone'], icon: 'preferences-system-time-symbolic' },
            { name: 'About', panel: 'info-overview', keywords: ['about', 'system', 'info', 'version', 'hardware'], icon: 'help-about-symbolic' },
        ];

        const results = [];
        for (const setting of settingsPanels) {
            let score = 0;
            const nameLower = setting.name.toLowerCase();

            if (nameLower === text) {
                score = 95;
            } else if (nameLower.startsWith(text)) {
                score = 75;
            } else if (nameLower.includes(text)) {
                score = 55;
            } else if (setting.keywords.some(kw => kw.startsWith(text))) {
                score = 45;
            } else if (setting.keywords.some(kw => kw.includes(text))) {
                score = 25;
            }

            if (score > 0) {
                results.push({
                    type: 'setting',
                    name: setting.name,
                    panel: setting.panel,
                    icon: setting.icon,
                    score: score,
                });
            }
        }

        return results;
    }

    _searchDocuments(text) {
        const results = [];

        // Only search if text is at least 2 characters
        if (text.length < 2) return results;

        // Get search folders from settings
        const homeDir = GLib.get_home_dir();
        const searchFolderPaths = this._settings.get_strv('search-folders');
        const searchFileContent = this._settings.get_boolean('search-file-content');

        // Expand ~ in paths
        const searchDirs = searchFolderPaths.map(p => {
            if (p.startsWith('~')) {
                return homeDir + p.substring(1);
            }
            return p;
        });

        // Common document extensions
        const documentExtensions = ['.pdf', '.doc', '.docx', '.odt', '.txt', '.rtf', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp', '.md', '.csv'];
        // Text file extensions that can be searched for content
        const textExtensions = ['.txt', '.md', '.csv', '.rtf', '.json', '.xml', '.html', '.css', '.js', '.py', '.sh'];

        for (const dirPath of searchDirs) {
            try {
                const dir = Gio.File.new_for_path(dirPath);
                if (!dir.query_exists(null)) continue;

                // Get folder display name
                let folderName = dirPath;
                if (dirPath.startsWith(homeDir)) {
                    folderName = '~' + dirPath.substring(homeDir.length);
                }

                const enumerator = dir.enumerate_children(
                    'standard::name,standard::type,standard::icon,standard::content-type',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );

                let fileInfo;
                let count = 0;
                const maxPerDir = 5;

                while ((fileInfo = enumerator.next_file(null)) !== null && count < maxPerDir) {
                    const fileName = fileInfo.get_name();
                    const fileNameLower = fileName.toLowerCase();
                    const fileType = fileInfo.get_file_type();

                    // Skip hidden files and directories
                    if (fileName.startsWith('.')) continue;
                    if (fileType === Gio.FileType.DIRECTORY) continue;

                    // Check if it's a document type
                    const isDocument = documentExtensions.some(ext => fileNameLower.endsWith(ext));
                    if (!isDocument) continue;

                    // Check if filename matches search
                    let score = 0;
                    let matchType = 'filename';
                    const nameWithoutExt = fileNameLower.replace(/\.[^/.]+$/, '');

                    if (nameWithoutExt === text) {
                        score = 90;
                    } else if (nameWithoutExt.startsWith(text)) {
                        score = 70;
                    } else if (nameWithoutExt.includes(text)) {
                        score = 50;
                    } else if (fileNameLower.includes(text)) {
                        score = 30;
                    }

                    // Search file content if enabled and no filename match
                    if (score === 0 && searchFileContent) {
                        const isTextFile = textExtensions.some(ext => fileNameLower.endsWith(ext));
                        if (isTextFile) {
                            const filePath = GLib.build_filenamev([dirPath, fileName]);
                            if (this._searchFileContent(filePath, text)) {
                                score = 25;
                                matchType = 'content';
                            }
                        }
                    }

                    if (score > 0) {
                        const filePath = GLib.build_filenamev([dirPath, fileName]);

                        results.push({
                            type: 'document',
                            name: fileName,
                            path: filePath,
                            folder: folderName,
                            icon: fileInfo.get_icon(),
                            contentType: fileInfo.get_content_type(),
                            score: score,
                            matchType: matchType,
                        });
                        count++;
                    }
                }

                enumerator.close(null);
            } catch (e) {
                // Skip directories that can't be read
            }
        }

        return results;
    }

    _searchFileContent(filePath, searchText) {
        try {
            const file = Gio.File.new_for_path(filePath);
            const fileInfo = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);

            // Only search files smaller than 1MB to avoid performance issues
            const fileSize = fileInfo.get_size();
            if (fileSize > 1024 * 1024) return false;

            const [success, contents] = file.load_contents(null);
            if (!success) return false;

            // Convert to string and search (case-insensitive)
            const textContent = new TextDecoder('utf-8').decode(contents).toLowerCase();
            return textContent.includes(searchText);
        } catch (e) {
            return false;
        }
    }

    _createSettingResultItem(setting) {
        const item = new St.Button({
            style_class: 'winbar-search-result-item',
            x_expand: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        const bin = new St.Bin({
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        item.set_child(bin);

        const box = new St.BoxLayout({
            style_class: 'winbar-search-result-item-box',
        });
        bin.set_child(box);

        // Settings icon
        const icon = new St.Icon({
            style_class: 'winbar-search-result-icon',
            icon_size: ICON_SIZE,
            icon_name: setting.icon || 'preferences-system-symbolic',
        });
        box.add_child(icon);

        // Text container
        const textBox = new St.BoxLayout({
            style_class: 'winbar-search-result-text-box',
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        box.add_child(textBox);

        // Setting name
        const nameLabel = new St.Label({
            text: setting.name,
            style_class: 'winbar-search-result-name',
        });
        textBox.add_child(nameLabel);

        // Description
        const descLabel = new St.Label({
            text: _('Settings'),
            style_class: 'winbar-search-result-description',
        });
        textBox.add_child(descLabel);

        // Click handler - open GNOME Settings at the specific panel
        item.connect('clicked', () => {
            try {
                const app = Shell.AppSystem.get_default().lookup_app('org.gnome.Settings.desktop') ||
                    Shell.AppSystem.get_default().lookup_app('gnome-control-center.desktop');
                if (app) {
                    // Launch with the specific panel
                    const context = global.create_app_launch_context(0, -1);
                    Gio.AppInfo.launch_default_for_uri(`gnome-control-center://${setting.panel}`, context);
                }
            } catch (e) {
                // Fallback: just open Settings app
                try {
                    Gio.AppInfo.launch_default_for_uri('gnome-control-center:', null);
                } catch (e2) {
                    log(`[Winbar] Failed to open settings: ${e2.message}`);
                }
            }
            this.close();
        });

        // Hover to select
        item.connect('enter-event', () => {
            const index = this._searchResultButtons.indexOf(item);
            if (index !== -1) {
                this._selectSearchResult(index);
            }
        });

        return item;
    }

    _createDocumentResultItem(doc) {
        const item = new St.Button({
            style_class: 'winbar-search-result-item',
            x_expand: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        const bin = new St.Bin({
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        item.set_child(bin);

        const box = new St.BoxLayout({
            style_class: 'winbar-search-result-item-box',
        });
        bin.set_child(box);

        // Document icon
        const icon = new St.Icon({
            style_class: 'winbar-search-result-icon',
            icon_size: ICON_SIZE,
        });
        if (doc.icon) {
            icon.set_gicon(doc.icon);
        } else {
            icon.set_icon_name('text-x-generic-symbolic');
        }
        box.add_child(icon);

        // Text container
        const textBox = new St.BoxLayout({
            style_class: 'winbar-search-result-text-box',
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        box.add_child(textBox);

        // Document name
        const nameLabel = new St.Label({
            text: doc.name,
            style_class: 'winbar-search-result-name',
        });
        textBox.add_child(nameLabel);

        // Folder location (and content match indicator)
        let descText = doc.folder;
        if (doc.matchType === 'content') {
            descText += ' â€¢ ' + _('Content match');
        }
        const descLabel = new St.Label({
            text: descText,
            style_class: 'winbar-search-result-description',
        });
        textBox.add_child(descLabel);

        // Store path for activation
        item._docPath = doc.path;

        // Click handler - open document with default app
        item.connect('clicked', () => {
            try {
                const file = Gio.File.new_for_path(doc.path);
                const uri = file.get_uri();
                Gio.AppInfo.launch_default_for_uri(uri, null);
            } catch (e) {
                log(`[Winbar] Failed to open document: ${e.message}`);
            }
            this.close();
        });

        // Hover to select
        item.connect('enter-event', () => {
            const index = this._searchResultButtons.indexOf(item);
            if (index !== -1) {
                this._selectSearchResult(index);
            }
        });

        return item;
    }

    _createSearchResultItem(app) {
        const item = new St.Button({
            style_class: 'winbar-search-result-item',
            x_expand: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        // Use a Bin to align content to the left
        const bin = new St.Bin({
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        item.set_child(bin);

        const box = new St.BoxLayout({
            style_class: 'winbar-search-result-item-box',
        });
        bin.set_child(box);

        // App icon
        const icon = new St.Icon({
            style_class: 'winbar-search-result-icon',
            icon_size: ICON_SIZE,
        });
        try {
            icon.set_gicon(app.get_icon());
        } catch (e) {
            icon.set_icon_name('application-x-executable-symbolic');
        }
        box.add_child(icon);

        // Text container
        const textBox = new St.BoxLayout({
            style_class: 'winbar-search-result-text-box',
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        box.add_child(textBox);

        // App name
        const nameLabel = new St.Label({
            text: app.get_name(),
            style_class: 'winbar-search-result-name',
        });
        textBox.add_child(nameLabel);

        // App description (if available)
        const description = app.get_description();
        if (description) {
            const descLabel = new St.Label({
                text: description.split('\n')[0].substring(0, 60) + (description.length > 60 ? '...' : ''),
                style_class: 'winbar-search-result-description',
            });
            textBox.add_child(descLabel);
        }

        // Store app ID for activation (app reference may become stale)
        const appId = app.get_id();
        item._appId = appId;
        item._app = app;

        // Click handler
        item.connect('clicked', () => {
            try {
                // Record this selection for search learning
                if (this._currentSearchQuery && this._currentSearchQuery.length >= 2) {
                    this._recordSearchSelection(this._currentSearchQuery, appId);
                }

                // Get fresh app reference from AppSystem
                const freshApp = Shell.AppSystem.get_default().lookup_app(appId);
                if (freshApp) {
                    // Open new window if possible, otherwise activate
                    if (typeof freshApp.open_new_window === 'function') {
                        freshApp.open_new_window(-1);
                    } else {
                        freshApp.activate();
                    }
                } else {
                    log(`[Winbar] Could not find app: ${appId}`);
                }
            } catch (e) {
                log(`[Winbar] Failed to activate app: ${e.message}`);
            }
            this.close();
        });

        // Hover to select
        item.connect('enter-event', () => {
            const index = this._searchResultButtons.indexOf(item);
            if (index >= 0) {
                this._selectSearchResult(index);
            }
        });

        return item;
    }

    _selectSearchResult(index) {
        // Bounds check
        if (this._searchResultButtons.length === 0) return;

        // Wrap around
        if (index < 0) index = this._searchResultButtons.length - 1;
        if (index >= this._searchResultButtons.length) index = 0;

        // Remove selection from previous
        if (this._selectedSearchIndex >= 0 && this._selectedSearchIndex < this._searchResultButtons.length) {
            this._searchResultButtons[this._selectedSearchIndex].remove_style_class_name('selected');
        }

        // Add selection to new
        this._selectedSearchIndex = index;
        this._searchResultButtons[index].add_style_class_name('selected');

        // Ensure visible in scroll view
        try {
            const item = this._searchResultButtons[index];
            const adjustment = this._searchResultsScroll.get_vadjustment();
            if (adjustment) {
                const [, itemY] = item.get_transformed_position();
                const [, scrollY] = this._searchResultsScroll.get_transformed_position();
                const scrollHeight = this._searchResultsScroll.get_height();
                const itemHeight = item.get_height();
                const relativeY = itemY - scrollY;

                if (relativeY < 0) {
                    adjustment.value += relativeY;
                } else if (relativeY + itemHeight > scrollHeight) {
                    adjustment.value += (relativeY + itemHeight - scrollHeight);
                }
            }
        } catch (e) {
            // Ignore scroll adjustment errors
        }
    }

    _clearSearchResults() {
        this._searchResultsBox.destroy_all_children();
        this._searchResultButtons = [];
        this._selectedSearchIndex = -1;
    }

    open() {
        if (this._isOpen) return;

        // Clean up any lingering drag state from previous session
        this._cleanupDragState();

        // Ensure any previous grab is released
        if (this._grab) {
            try {
                this._grab.dismiss();
            } catch (e) {
                // Ignore
            }
            this._grab = null;
        }

        this._isOpen = true;
        this._searchEntry.set_text('');
        this._powerMenu.hide();

        // Reset scroll position to top
        try {
            const vAdjust = this._mainScroll.get_vadjustment();
            if (vAdjust) {
                vAdjust.set_value(0);
            }
        } catch (e) {
            // Ignore scroll reset errors
        }

        // Get start button and monitor from winbar reference
        const startButton = this._winbar?._startButton;
        const monitor = this._winbar?._monitor || Main.layoutManager.primaryMonitor;

        // Show temporarily to calculate size
        this.show();
        this.opacity = 255; // Make parent visible

        const [, menuHeight] = this.get_preferred_height(-1);
        const [, menuWidth] = this.get_preferred_width(-1);

        if (startButton) {
            const [buttonX, buttonY] = startButton.get_transformed_position();

            // Position centered above start button
            let x = buttonX - (menuWidth / 2) + 24;
            let y = buttonY - menuHeight - MENU_OFFSET_PX;

            // Keep within bounds
            if (x < monitor.x + MENU_SCREEN_PADDING_PX) x = monitor.x + MENU_SCREEN_PADDING_PX;
            if (x + menuWidth > monitor.x + monitor.width - MENU_SCREEN_PADDING_PX)
                x = monitor.x + monitor.width - menuWidth - MENU_SCREEN_PADDING_PX;

            this.set_position(x, y);
        } else {
            // Fallback: bottom left
            this.set_position(monitor.x + MENU_SCREEN_PADDING_PX, monitor.y + monitor.height - menuHeight - 60);
        }

        // Ensure reactive is enabled when opening
        this.reactive = true;

        // Push modal to grab all input events (catches clicks on DING desktop icons too)
        // In GNOME 45+, pushModal returns a Clutter.Grab object
        try {
            this._grab = Main.pushModal(this, {
                actionMode: Shell.ActionMode.POPUP,
            });
        } catch (e) {
            // Modal grab failed, menu will still work with captured events
            this._grab = null;
        }

        // Remove any existing transitions before starting new animation
        this._container.remove_all_transitions();

        // Set initial state - invisible and slightly below
        this._container.opacity = 0;
        this._container.translation_y = 20;

        // Delay animation slightly to ensure actor is fully mapped (X11 compatibility)
        GLib.timeout_add(GLib.PRIORITY_HIGH, ANIMATION_FRAME_DELAY, () => {
            // Animate slide up and fade in (Windows 11 style)
            this._container.ease({
                opacity: 255,
                translation_y: 0,
                duration: ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    global.stage.set_key_focus(this._searchEntry);
                }
            });
            return GLib.SOURCE_REMOVE;
        });

        // Add click-outside handler
        this._capturedEventId = global.stage.connect('captured-event', (actor, event) => {
            if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                const [x, y] = event.get_coords();
                const [menuX, menuY] = this._container.get_transformed_position();
                const [menuW, menuH] = this._container.get_size();

                // Check if click is on context menu
                if (this._appContextMenuScroll.visible) {
                    const [ctxX, ctxY] = this._appContextMenuScroll.get_transformed_position();
                    const [ctxW, ctxH] = this._appContextMenuScroll.get_size();
                    if (x >= ctxX && x <= ctxX + ctxW && y >= ctxY && y <= ctxY + ctxH) {
                        return Clutter.EVENT_PROPAGATE;
                    }
                    // Click outside context menu - close it
                    this._hideAppContextMenu();
                    return Clutter.EVENT_STOP;
                }

                // Check if click is outside main menu container
                if (x < menuX || x > menuX + menuW || y < menuY || y > menuY + menuH) {
                    // Check if click is on power menu (which is outside container)
                    if (this._powerMenu.visible) {
                        const [pwrX, pwrY] = this._powerMenu.get_transformed_position();
                        const [pwrW, pwrH] = this._powerMenu.get_size();
                        if (x >= pwrX && x <= pwrX + pwrW && y >= pwrY && y <= pwrY + pwrH) {
                            return Clutter.EVENT_PROPAGATE;
                        }
                    }
                    this.close();
                    return Clutter.EVENT_STOP;
                } else {
                    // Click is inside main container - close power menu if open
                    // unless clicking on power button itself
                    if (this._powerMenu.visible && !this._isClickOnPowerArea(x, y)) {
                        this._powerMenu.hide();
                    }
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Watch for focus changes - close menu when another window gets focus
        this._focusWindowChangedId = global.display.connect('notify::focus-window', () => {
            const focusWindow = global.display.get_focus_window();
            // If a window gets focus (not null, which happens when clicking on desktop/panel)
            // and the menu is open, close it
            if (focusWindow && this._isOpen) {
                this.close();
            }
        });

        // Also watch for overview being shown
        this._overviewShowingId = Main.overview.connect('showing', () => {
            if (this._isOpen) {
                this.close();
            }
        });
    }

    close() {
        if (!this._isOpen) return;

        this._isOpen = false;

        // Clean up any active drag operation FIRST
        this._cleanupDragState();

        // IMMEDIATELY stop capturing events and make non-reactive
        // This prevents ghost clicks on invisible menu
        this.reactive = false;

        // Pop modal grab using Main.popModal - MUST use this to restore actionMode
        if (this._grab) {
            try {
                Main.popModal(this._grab);
            } catch (e) {
                // Ignore errors - grab may already be dismissed
            }
            this._grab = null;
        }

        // Remove click-outside handler FIRST before anything else
        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = null;
        }

        // Remove focus window change handler
        if (this._focusWindowChangedId) {
            global.display.disconnect(this._focusWindowChangedId);
            this._focusWindowChangedId = null;
        }

        // Remove overview showing handler
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = null;
        }

        this._powerMenu.hide();
        this._hideAppContextMenu();

        // Remove any existing transitions before starting new animation
        this._container.remove_all_transitions();

        // Animate slide down and fade out (Windows 11 style)
        this._container.ease({
            opacity: 0,
            translation_y: 20,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                // Guard against disposed widgets during extension reload
                try {
                    if (this._container && !this._isDestroyed) {
                        // After animation, hide and move off-screen to prevent ghost clicks
                        this.hide();
                        this._container.translation_y = 0;
                        this._container.opacity = 255;
                        this.set_position(-10000, -10000);
                        this.emit('menu-closed');
                    }
                } catch (e) {
                    // Widget may have been disposed during animation
                }
            }
        });
    }

    toggle() {
        if (this._isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    get isOpen() {
        return this._isOpen;
    }

    _addBlurEffect() {
        // Add blur effect for modern frosted glass appearance
        addBlurEffect(this._container);
    }

    updateTheme() {
        const effectiveMode = getEffectiveThemeMode(this._settings);
        let bgColor, borderColor, textColor, searchBg, searchBorder;
        const isLight = effectiveMode === 2;

        if (isLight) {
            // Light mode
            bgColor = THEME_COLORS.light.bg;
            borderColor = THEME_COLORS.light.border;
            textColor = '#000000';
            searchBg = 'rgba(0, 0, 0, 0.04)';
            searchBorder = THEME_COLORS.light.border;
        } else {
            // Dark mode
            bgColor = THEME_COLORS.dark.bg;
            borderColor = THEME_COLORS.dark.border;
            textColor = '#ffffff';
            searchBg = 'rgba(255, 255, 255, 0.06)';
            searchBorder = THEME_COLORS.dark.border;
        }

        // Toggle light mode CSS class
        if (isLight) {
            this.add_style_class_name('winbar-start-menu-light');
        } else {
            this.remove_style_class_name('winbar-start-menu-light');
        }

        // Update main container
        this._container.set_style(`
            background-color: ${bgColor};
            border-radius: 12px;
            border: 1px solid ${borderColor};
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            padding: 20px;
            min-width: 600px;
            height: 640px;
        `);

        // Update search entry - remove inline styles to let CSS handle it via class
        if (this._searchEntry) {
            this._searchEntry.set_style(null);
        }

        // Update bottom bar border
        if (this._bottomBar) {
            this._bottomBar.set_style(`
                margin-top: 16px;
                padding-top: 16px;
                border-top: 1px solid ${borderColor};
            `);
        }
    }

    destroy() {
        // Mark as destroyed to prevent animation callbacks from accessing disposed widgets
        this._isDestroyed = true;

        // Pop modal grab if still active
        if (this._grab) {
            try {
                this._grab.dismiss();
            } catch (e) { /* ignore */ }
            this._grab = null;
        }

        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = null;
        }

        // Disconnect focus window handler
        if (this._focusWindowChangedId) {
            global.display.disconnect(this._focusWindowChangedId);
            this._focusWindowChangedId = null;
        }

        // Disconnect overview handler
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = null;
        }

        // Stop any running animations
        this._container?.remove_all_transitions();

        this._powerMenu?.destroy();

        // Disconnect pinned apps settings listener
        if (this._pinnedAppsChangedId) {
            this._settings.disconnect(this._pinnedAppsChangedId);
            this._pinnedAppsChangedId = null;
        }

        // Disconnect search synonyms settings listener
        if (this._synonymsChangedId) {
            this._settings.disconnect(this._synonymsChangedId);
            this._synonymsChangedId = null;
        }

        // Unsubscribe AccountsService DBus signal if set
        try {
            if (this._accountsSignalId) {
                Gio.DBus.system.signal_unsubscribe(this._accountsSignalId);
                this._accountsSignalId = null;
            }
        } catch (e) {
            log(`[Winbar] Error unsubscribing Accounts signal: ${e.message}`);
        }

        // Disconnect avatar handlers (file monitor and user notify)
        this._disconnectAvatarHandlers();

        if (this._avatarReloadTimeout) {
            GLib.source_remove(this._avatarReloadTimeout);
            this._avatarReloadTimeout = null;
        }

        super.destroy();
    }
});
