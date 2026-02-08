import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { getEffectiveThemeMode, addBlurEffect } from '../utils.js';
import {
    ANIMATION_TIME,
    ANIMATION_FRAME_DELAY,
    MENU_OFFSET_PX,
    MENU_SCREEN_PADDING_PX,
    THEME_COLORS,
    SEARCH_BATCH_SIZE,
    DEFAULT_SEARCH_SYNONYMS,
    MAX_FILE_SIZE_BYTES,
} from '../constants.js';

// Quick link definitions for settings panels
const QUICK_LINK_MAP = {
    'sound': { name: 'Sound', panel: 'sound', icon: 'audio-speakers-symbolic' },
    'network': { name: 'Network', panel: 'network', icon: 'network-wired-symbolic' },
    'bluetooth': { name: 'Bluetooth', panel: 'bluetooth', icon: 'bluetooth-symbolic' },
    'display': { name: 'Displays', panel: 'display', icon: 'preferences-desktop-display-symbolic' },
    'power': { name: 'Power', panel: 'power', icon: 'preferences-system-power-symbolic' },
    'search': { name: 'Search', panel: 'search', icon: 'preferences-system-search-symbolic' },
    'wifi': { name: 'Wi-Fi', panel: 'wifi', icon: 'network-wireless-symbolic' },
    'privacy': { name: 'Privacy', panel: 'privacy', icon: 'preferences-system-privacy-symbolic' },
    'keyboard': { name: 'Keyboard', panel: 'keyboard', icon: 'input-keyboard-symbolic' },
    'mouse': { name: 'Mouse', panel: 'mouse', icon: 'input-mouse-symbolic' },
    'printers': { name: 'Printers', panel: 'printers', icon: 'printer-symbolic' },
    'users': { name: 'Users', panel: 'user-accounts', icon: 'system-users-symbolic' },
};

// Settings panels for search
const SETTINGS_PANELS = [
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

// Document extensions
const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.odt', '.txt', '.rtf', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp', '.md', '.csv'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.rtf', '.json', '.xml', '.html', '.css', '.js', '.py', '.sh'];

export const SearchDialog = GObject.registerClass({
    GTypeName: 'WinbarSearchDialog',
}, class SearchDialog extends St.Widget {
    _init(extension, searchButton, winbar) {
        super._init({
            style_class: 'winbar-search-dialog',
            visible: false,
            reactive: true,
        });

        this._extension = extension;
        this._searchButton = searchButton;
        this._winbar = winbar;
        this._settings = extension.getSettings();
        this._isOpen = false;
        this._isDestroyed = false;

        // Search state
        this._query = '';
        this._currentSearchQuery = '';
        this._currentCategory = 'all';
        this._selectedIndex = -1;
        this._resultButtons = [];
        this._results = [];
        this._debounceTimeoutId = null;
        this._searchGeneration = 0;
        this._overviewDirty = true;

        // Cached data
        this._cachedApps = [];
        this._searchLearning = {};
        this._searchSynonyms = {};
        this._appToSynonyms = {};
        this._lastThemeMode = null;
        this._syncingText = false;

        this._topAppsPopulateId = null;
        this._recentPopulateId = null;
        this._quickLinksPopulateId = null;
        this._overviewPopulateToken = 0;

        // Display chunking state
        this._displayToken = 0;
        this._displayChunkId = null;

        // Deferred icon loading — icons are created with a cheap placeholder
        // and the real gicon is set via idle callbacks to avoid blocking the
        // compositor with disk I/O + PNG decode + GPU texture upload all in
        // one frame (the root cause of the 1-second freeze).
        this._resultIconQueue = [];
        this._resultIconSourceId = null;
        this._overviewIconQueue = [];
        this._overviewIconSourceId = null;

        // Build UI
        this._buildUI();

        // Add to chrome
        Main.layoutManager.addChrome(this, {
            affectsStruts: false,
            trackFullscreen: true,
        });
        this.hide();
        this.set_position(-10000, -10000);

        // Initialize search subsystems
        this._initSearchSynonyms();
        this._loadSearchLearning();
        this._prefetchApps();

        // Pre-populate overview during construction (dialog is hidden/offscreen).
        // This mirrors what the start menu does — all widgets are built upfront
        // so opening the dialog has zero widget-creation cost.  Real icons are
        // loaded via deferred idle callbacks (see _processIconQueue).
        this._populateOverview();

        // Apply theme
        this._applyTheme();

        // Watch for app installations
        this._installedChangedId = Shell.AppSystem.get_default().connect('installed-changed', () => {
            this._overviewDirty = true;
            this._prefetchApps();
        });

        // Key press handler
        this.connect('key-press-event', (actor, event) => {
            return this._onKeyPress(event);
        });
    }

    // ========== UI Construction ==========

    _buildUI() {
        // Main container
        this._container = new St.BoxLayout({
            style_class: 'winbar-search-dialog-container',
            vertical: true,
        });
        this.add_child(this._container);

        // Blur effect
        addBlurEffect(this._container);

        // Search box at top
        this._buildSearchBox();

        // Category bar
        this._buildCategoryBar();

        // Scrollable content
        this._contentScroll = new St.ScrollView({
            style_class: 'winbar-search-content',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            y_expand: true,
        });
        this._container.add_child(this._contentScroll);

        this._contentBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        this._contentScroll.set_child(this._contentBox);

        // Overview (shown when no query)
        this._buildOverview();

        // Results (shown during search)
        this._buildResults();
    }

    _buildSearchBox() {
        this._searchBox = new St.BoxLayout({
            style_class: 'winbar-search-box-dialog',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._container.add_child(this._searchBox);

        this._searchIcon = new St.Icon({
            icon_name: 'edit-find-symbolic',
            icon_size: 16,
            style_class: 'winbar-search-box-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._searchBox.add_child(this._searchIcon);

        this._searchEntry = new St.Entry({
            style_class: 'winbar-search-entry-dialog',
            hint_text: _('Search apps, settings, docs'),
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._searchBox.add_child(this._searchEntry);

        this._clutterText = this._searchEntry.clutter_text;
        this._clutterText.set_single_line_mode(true);
        this._clutterText.set_activatable(true);

        this._clutterText.connect('text-changed', () => {
            if (this._syncingText) return;
            this._onSearchTextChanged();
            // Sync text back to the taskbar entry
            if (this._searchButton) {
                this._syncingText = true;
                this._searchButton._clutterText.set_text(this._searchEntry.get_text());
                this._syncingText = false;
            }
        });

        this._clutterText.connect('activate', () => {
            this._activateSelected();
        });
    }

    _buildCategoryBar() {
        this._categoryBar = new St.BoxLayout({
            style_class: 'winbar-search-categories',
            x_expand: true,
        });
        this._container.add_child(this._categoryBar);

        const categories = [
            { id: 'all', label: _('All'), setting: 'search-category-all' },
            { id: 'apps', label: _('Apps'), setting: 'search-category-apps' },
            { id: 'documents', label: _('Documents'), setting: 'search-category-documents' },
            { id: 'settings', label: _('Settings'), setting: 'search-category-settings' },
            { id: 'folders', label: _('Folders'), setting: 'search-category-folders' },
        ];

        this._categoryButtons = [];
        for (const cat of categories) {
            if (!this._settings.get_boolean(cat.setting)) continue;

            const btn = new St.Button({
                style_class: 'winbar-search-category-button',
                label: cat.label,
                toggle_mode: true,
                can_focus: true,
            });
            btn._categoryId = cat.id;

            if (cat.id === 'all') {
                btn.set_checked(true);
            }

            btn.connect('clicked', () => {
                this._onCategoryClicked(btn);
            });

            this._categoryBar.add_child(btn);
            this._categoryButtons.push(btn);
        }
    }

    _buildOverview() {
        this._overviewBox = new St.BoxLayout({
            style_class: 'winbar-search-overview',
            vertical: true,
            x_expand: true,
        });
        this._contentBox.add_child(this._overviewBox);

        // Top apps section
        if (this._settings.get_boolean('search-show-top-apps')) {
            this._topAppsSection = new St.BoxLayout({
                style_class: 'winbar-search-section',
                vertical: true,
            });
            this._overviewBox.add_child(this._topAppsSection);

            this._topAppsLabel = new St.Label({
                text: _('Top apps'),
                style_class: 'winbar-search-section-title',
            });
            this._topAppsSection.add_child(this._topAppsLabel);

            this._topAppsGrid = new St.BoxLayout({
                style_class: 'winbar-search-top-apps',
                x_expand: true,
            });
            this._topAppsSection.add_child(this._topAppsGrid);
        }

        // Recent apps section
        if (this._settings.get_boolean('search-show-recent-apps')) {
            this._recentSection = new St.BoxLayout({
                style_class: 'winbar-search-section',
                vertical: true,
            });
            this._overviewBox.add_child(this._recentSection);

            this._recentLabel = new St.Label({
                text: _('Recent'),
                style_class: 'winbar-search-section-title',
            });
            this._recentSection.add_child(this._recentLabel);

            this._recentList = new St.BoxLayout({
                style_class: 'winbar-search-recent-list',
                vertical: true,
                x_expand: true,
            });
            this._recentSection.add_child(this._recentList);
        }

        // Quick links section
        if (this._settings.get_boolean('search-show-quick-links')) {
            this._quickLinksSection = new St.BoxLayout({
                style_class: 'winbar-search-section',
                vertical: true,
            });
            this._overviewBox.add_child(this._quickLinksSection);

            this._quickLinksLabel = new St.Label({
                text: _('Quick links'),
                style_class: 'winbar-search-section-title',
            });
            this._quickLinksSection.add_child(this._quickLinksLabel);

            this._quickLinksBox = new St.BoxLayout({
                style_class: 'winbar-search-quick-links',
                x_expand: true,
            });
            this._quickLinksSection.add_child(this._quickLinksBox);
        }
    }

    _buildResults() {
        this._resultsBox = new St.BoxLayout({
            style_class: 'winbar-search-results-list',
            vertical: true,
            x_expand: true,
            visible: false,
        });
        this._contentBox.add_child(this._resultsBox);

        this._noResultsLabel = new St.Label({
            text: _('No results found'),
            style_class: 'winbar-search-no-results-dialog',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._contentBox.add_child(this._noResultsLabel);
    }

    // ========== Overview Population ==========

    _populateOverview() {
        this._cancelOverviewIcons();
        const token = ++this._overviewPopulateToken;
        this._populateTopApps(token);
        this._populateRecent(token);
        this._populateQuickLinks(token);
        this._overviewDirty = false;
        // Don't process the icon queue here — if the dialog is hidden
        // (e.g. during construction), set_gicon would store the reference
        // but all textures would load on the first visible frame, causing
        // a freeze.  Instead, open() and _showOverview() drain the queue
        // while the dialog is visible so texture loads are spread across
        // frames via idle callbacks.
    }

    _populateTopApps(token) {
        if (token !== this._overviewPopulateToken) return;
        if (!this._topAppsGrid) return;

        this._topAppsGrid.destroy_all_children();

        if (this._topAppsPopulateId) {
            GLib.source_remove(this._topAppsPopulateId);
            this._topAppsPopulateId = null;
        }

        // Respect the setting at populate time (not just build time)
        if (!this._settings.get_boolean('search-show-top-apps')) {
            if (this._topAppsSection) this._topAppsSection.hide();
            return;
        }
        if (this._topAppsSection) this._topAppsSection.show();

        const count = this._settings.get_int('search-top-apps-count');

        let topApps = [];
        try {
            const usage = Shell.AppUsage.get_default();
            topApps = usage.get_most_used()
                .filter(app => app && app.get_name())
                .slice(0, count);
        } catch (e) {}

        if (topApps.length < count) {
            try {
                const favIds = global.settings.get_strv('favorite-apps');
                const appSystem = Shell.AppSystem.get_default();
                for (const id of favIds) {
                    if (topApps.length >= count) break;
                    const app = appSystem.lookup_app(id);
                    if (app && !topApps.includes(app)) topApps.push(app);
                }
            } catch (e) {}
        }

        for (const app of topApps) {
            if (!app) continue;

            const btn = new St.Button({
                style_class: 'winbar-search-top-app',
                can_focus: true,
                reactive: true,
                track_hover: true,
            });

            const box = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.CENTER,
            });
            btn.set_child(box);

            const icon = new St.Icon({
                icon_name: 'application-x-executable-symbolic',
                icon_size: 32,
            });
            try {
                const gicon = app.get_icon();
                if (gicon) this._overviewIconQueue.push({ icon, gicon });
            } catch (e) {}
            icon.add_style_class_name('winbar-search-top-app-icon');
            box.add_child(icon);

            const label = new St.Label({
                text: app.get_name(),
                style_class: 'winbar-search-top-app-label',
                x_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.set_ellipsize(3);
            label.set_style('max-width: 80px;');
            box.add_child(label);

            btn.connect('clicked', () => {
                app.activate();
                this.close();
            });

            this._topAppsGrid.add_child(btn);
        }
    }

    _populateRecent(token) {
        if (!this._recentList) return;

        this._recentList.destroy_all_children();

        if (this._recentPopulateId) {
            GLib.source_remove(this._recentPopulateId);
            this._recentPopulateId = null;
        }

        // Respect the setting at populate time (not just build time)
        if (!this._settings.get_boolean('search-show-recent-apps')) {
            if (this._recentSection) this._recentSection.hide();
            return;
        }
        if (this._recentSection) this._recentSection.show();

        let recentApps = [];
        try {
            const usage = Shell.AppUsage.get_default();
            recentApps = usage.get_most_used()
                .filter(app => app && app.get_name())
                .slice(0, 5);
        } catch (e) {
            // AppUsage may not be available
        }

        if (recentApps.length === 0) {
            const empty = new St.Label({
                text: _('No recent apps'),
                style_class: 'winbar-search-recent-empty',
            });
            this._recentList.add_child(empty);
            return;
        }

        for (const app of recentApps) {
            if (!app) continue;

            const item = new St.Button({
                style_class: 'winbar-search-recent-item',
                x_expand: true,
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            const box = new St.BoxLayout({
                style_class: 'winbar-search-recent-item-box',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.set_child(box);

            const icon = new St.Icon({
                icon_name: 'application-x-executable-symbolic',
                icon_size: 24,
            });
            try {
                const gicon = app.get_icon();
                if (gicon) this._overviewIconQueue.push({ icon, gicon });
            } catch (e) {}
            icon.add_style_class_name('winbar-search-recent-icon');
            icon.set_y_align(Clutter.ActorAlign.CENTER);
            box.add_child(icon);

            const textBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(textBox);

            textBox.add_child(new St.Label({
                text: app.get_name(),
                style_class: 'winbar-search-recent-name',
            }));

            const desc = app.get_description();
            if (desc) {
                const descLabel = new St.Label({
                    text: desc,
                    style_class: 'winbar-search-recent-description',
                });
                descLabel.clutter_text.set_ellipsize(3);
                textBox.add_child(descLabel);
            }

            item.connect('clicked', () => {
                app.activate();
                this.close();
            });

            this._recentList.add_child(item);
        }
    }

    _populateQuickLinks(token) {
        if (!this._quickLinksBox) return;

        this._quickLinksBox.destroy_all_children();

        if (this._quickLinksPopulateId) {
            GLib.source_remove(this._quickLinksPopulateId);
            this._quickLinksPopulateId = null;
        }

        // Respect the setting at populate time (not just build time)
        if (!this._settings.get_boolean('search-show-quick-links')) {
            if (this._quickLinksSection) this._quickLinksSection.hide();
            return;
        }
        if (this._quickLinksSection) this._quickLinksSection.show();

        const linkIds = this._settings.get_strv('search-quick-links');

        for (const id of linkIds) {
            const info = QUICK_LINK_MAP[id];
            if (!info) continue;

            const btn = new St.Button({
                style_class: 'winbar-search-quick-link',
                can_focus: true,
                reactive: true,
                track_hover: true,
            });

            const box = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.set_child(box);

            box.add_child(new St.Icon({
                icon_name: info.icon,
                icon_size: 24,
                style_class: 'winbar-search-quick-link-icon',
                x_align: Clutter.ActorAlign.CENTER,
            }));

            box.add_child(new St.Label({
                text: info.name,
                style_class: 'winbar-search-quick-link-label',
                x_align: Clutter.ActorAlign.CENTER,
            }));

            btn.connect('clicked', () => {
                try {
                    GLib.spawn_command_line_async(`gnome-control-center ${info.panel}`);
                } catch (e) {
                    log(`[Winbar] Failed to open settings: ${e.message}`);
                }
                this.close();
            });

            this._quickLinksBox.add_child(btn);
        }
    }

    // ========== Search Synonyms & Learning ==========

    _initSearchSynonyms() {
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

        // Build reverse mapping
        this._appToSynonyms = {};
        for (const [term, apps] of Object.entries(this._searchSynonyms)) {
            for (const app of apps) {
                const key = app.toLowerCase();
                if (!this._appToSynonyms[key]) {
                    this._appToSynonyms[key] = [];
                }
                this._appToSynonyms[key].push(term);
            }
        }

        // Listen for runtime changes
        if (!this._synonymsChangedId) {
            this._synonymsChangedId = this._settings.connect('changed::search-synonyms', () => {
                this._initSearchSynonyms();
            });
        }
    }

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

        const normalizedQuery = query.toLowerCase().trim();

        if (!this._searchLearning[normalizedQuery]) {
            this._searchLearning[normalizedQuery] = {};
        }
        if (!this._searchLearning[normalizedQuery][appId]) {
            this._searchLearning[normalizedQuery][appId] = 0;
        }
        this._searchLearning[normalizedQuery][appId]++;

        // Learn from prefix queries
        for (let i = 2; i < normalizedQuery.length; i++) {
            const prefix = normalizedQuery.substring(0, i);
            if (!this._searchLearning[prefix]) {
                this._searchLearning[prefix] = {};
            }
            if (!this._searchLearning[prefix][appId]) {
                this._searchLearning[prefix][appId] = 0;
            }
            this._searchLearning[prefix][appId] += 0.5;
        }

        this._saveSearchLearning();
    }

    _getLearnedScore(query, appId) {
        const normalizedQuery = query.toLowerCase().trim();
        if (this._searchLearning[normalizedQuery] && this._searchLearning[normalizedQuery][appId]) {
            const count = this._searchLearning[normalizedQuery][appId];
            return Math.min(50, Math.log2(count + 1) * 15);
        }
        return 0;
    }

    _getSynonymMatches(query) {
        const normalizedQuery = query.toLowerCase().trim();
        const matches = new Set();

        for (const [term, apps] of Object.entries(this._searchSynonyms)) {
            if (term.startsWith(normalizedQuery) || normalizedQuery.startsWith(term)) {
                apps.forEach(app => matches.add(app.toLowerCase()));
            }
        }

        return matches;
    }

    // ========== App Prefetch ==========

    _prefetchApps() {
        try {
            const appSystem = Shell.AppSystem.get_default();
            const allApps = appSystem.get_installed().filter(app => {
                try {
                    return app.should_show();
                } catch (e) {
                    return false;
                }
            });

            // Pre-compute search data to avoid recomputing on every keystroke
            this._cachedApps = allApps.map(app => {
                const name = app.get_name() || '';
                const id = app.get_id() || '';
                const description = app.get_description() || '';
                const nameLower = name.toLowerCase();
                const idLower = id.toLowerCase();
                let gicon = null;
                try { gicon = app.get_icon(); } catch (e) {}
                return {
                    app,
                    name,
                    nameLower,
                    id,
                    idLower,
                    descLower: description.toLowerCase(),
                    description,
                    idParts: idLower.replace('.desktop', '').split('.'),
                    words: nameLower.split(/[\s\-_\.]+/),
                    gicon,
                };
            });
        } catch (e) {
            this._cachedApps = [];
        }
    }

    // ========== Deferred Icon Loading ==========

    /**
     * Process an icon queue in batches via idle callbacks.
     * Each idle tick sets real gicons on `batch` icons, allowing the
     * compositor to paint frames between batches so icon texture loading
     * (disk I/O + decode) doesn't block the main thread.
     */
    _processIconQueue(queueProp, sourceIdProp, batch = 3) {
        if (this[sourceIdProp]) {
            GLib.source_remove(this[sourceIdProp]);
            this[sourceIdProp] = null;
        }

        const queue = this[queueProp];
        if (!queue || queue.length === 0) return;

        let idx = 0;
        this[sourceIdProp] = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (this._isDestroyed) {
                this[sourceIdProp] = null;
                return GLib.SOURCE_REMOVE;
            }

            const end = Math.min(idx + batch, queue.length);
            for (; idx < end; idx++) {
                try {
                    queue[idx].icon.set_gicon(queue[idx].gicon);
                } catch (e) {
                    // Icon widget may have been destroyed
                }
            }

            if (idx >= queue.length) {
                this[sourceIdProp] = null;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _cancelResultIcons() {
        this._resultIconQueue = [];
        if (this._resultIconSourceId) {
            GLib.source_remove(this._resultIconSourceId);
            this._resultIconSourceId = null;
        }
    }

    _cancelOverviewIcons() {
        this._overviewIconQueue = [];
        if (this._overviewIconSourceId) {
            GLib.source_remove(this._overviewIconSourceId);
            this._overviewIconSourceId = null;
        }
    }

    // ========== Fuzzy Matching ==========

    _fuzzyMatch(query, textLower) {
        let queryIndex = 0;
        let consecutiveMatches = 0;
        let maxConsecutive = 0;

        for (let i = 0; i < textLower.length && queryIndex < query.length; i++) {
            if (textLower[i] === query[queryIndex]) {
                queryIndex++;
                consecutiveMatches++;
                maxConsecutive = Math.max(maxConsecutive, consecutiveMatches);
            } else {
                consecutiveMatches = 0;
            }
        }

        if (queryIndex === query.length) {
            const lengthRatio = query.length / textLower.length;
            const consecutiveRatio = maxConsecutive / query.length;
            return (lengthRatio * 0.3 + consecutiveRatio * 0.7) * 30;
        }

        return 0;
    }

    _wordStartsWithMatch(query, words) {
        for (const word of words) {
            if (word.startsWith(query)) {
                return true;
            }
        }
        return false;
    }

    // ========== Search Execution ==========

    _onSearchTextChanged() {
        const text = this._searchEntry.get_text().trim();
        this._query = text;
        this._currentSearchQuery = text;

        if (this._debounceTimeoutId) {
            GLib.source_remove(this._debounceTimeoutId);
            this._debounceTimeoutId = null;
        }

        // Increment generation to cancel any in-flight async document search
        this._searchGeneration = (this._searchGeneration || 0) + 1;
        // Stop loading icons from the previous search's results
        this._cancelResultIcons();

        if (!text || text.length === 0) {
            this._showOverview();
            return;
        }

        // Switch to results view immediately
        this._overviewBox.hide();
        this._noResultsLabel.hide();
        // resultsBox will be shown by _displayResults once the first chunk is ready

        // Short debounce, then run search
        this._debounceTimeoutId = GLib.timeout_add(GLib.PRIORITY_HIGH, 150, () => {
            this._debounceTimeoutId = null;
            if (this._isDestroyed) return GLib.SOURCE_REMOVE;
            this._performSearch(text.toLowerCase());
            return GLib.SOURCE_REMOVE;
        });
    }

    _performSearch(text) {
        if (this._cachedApps.length === 0) {
            this._prefetchApps();
        }

        const generation = this._searchGeneration;
        const synonymMatches = this._getSynonymMatches(text);
        const maxResults = this._settings.get_int('search-max-results');

        // App search — only if apps category is enabled
        const appResults = [];
        const searchApps = this._settings.get_boolean('search-category-apps');
        if (searchApps) {
            for (const cached of this._cachedApps) {
                try {
                    const score = this._scoreApp(cached, text, synonymMatches);
                    if (score > 0) {
                        appResults.push({
                            type: 'app',
                            app: cached.app,
                            gicon: cached.gicon,
                            score,
                            name: cached.name,
                            description: cached.description,
                        });
                    }
                } catch (e) {
                    // Skip
                }
            }
        }

        // Settings search — synchronous, fast (small fixed array)
        const searchSettingsPanels = this._settings.get_boolean('search-settings-panels');
        const settingsResults = searchSettingsPanels ? this._searchSettings(text) : [];

        // Display app + settings results immediately
        this._pendingAppResults = appResults;
        this._pendingSettingsResults = settingsResults;
        this._collectAndDisplay(appResults, settingsResults, [], maxResults);

        // Document search — async (file I/O), appends results when done
        const searchDocumentsEnabled = this._settings.get_boolean('search-documents');
        if (searchDocumentsEnabled && text.length >= 2) {
            this._searchDocumentsAsync(text, generation, () => {
                // Callback when document search completes
                if (this._isDestroyed || this._searchGeneration !== generation) return;
                this._collectAndDisplay(
                    this._pendingAppResults,
                    this._pendingSettingsResults,
                    this._pendingDocResults || [],
                    maxResults
                );
            });
        }
    }

    _scoreApp(cached, text, synonymMatches) {
        const { nameLower, idLower, descLower, id, idParts, words } = cached;

        let score = 0;

        if (nameLower === text) {
            score = 100;
        } else if (nameLower.startsWith(text)) {
            score = 85;
        } else if (this._wordStartsWithMatch(text, words)) {
            score = 75;
        } else if (nameLower.includes(text)) {
            score = 65;
        } else if (synonymMatches.size > 0) {
            for (const synonym of synonymMatches) {
                if (nameLower.includes(synonym) || idLower.includes(synonym)) {
                    score = 60;
                    break;
                }
            }
        }

        // Match against individual ID parts (e.g., "discord" in "com.discordapp.Discord")
        if (score === 0) {
            for (const part of idParts) {
                if (part === text) {
                    score = 70;
                    break;
                } else if (part.startsWith(text)) {
                    score = 55;
                    break;
                } else if (part.includes(text)) {
                    score = 45;
                    break;
                }
            }
        }

        if (score === 0 && idLower.includes(text)) {
            score = 50;
        }
        if (score === 0) {
            const fuzzyScore = this._fuzzyMatch(text, nameLower);
            if (fuzzyScore > 10) {
                score = Math.min(45, fuzzyScore);
            }
        }
        if (score === 0 && descLower.includes(text)) {
            score = 25;
        }
        if (score === 0 && this._appToSynonyms[nameLower]) {
            for (const synonym of this._appToSynonyms[nameLower]) {
                if (synonym.includes(text) || text.includes(synonym)) {
                    score = 55;
                    break;
                }
            }
        }

        if (score > 0) {
            score += this._getLearnedScore(text, id);
        }

        return score;
    }

    _collectAndDisplay(appResults, settingsResults, documentResults, maxResults) {
        if (this._isDestroyed) return;

        let allResults = [...appResults, ...settingsResults, ...documentResults];
        allResults.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });

        // Filter by category
        if (this._currentCategory !== 'all') {
            if (this._currentCategory === 'apps') {
                allResults = allResults.filter(r => r.type === 'app');
            } else if (this._currentCategory === 'documents' || this._currentCategory === 'folders') {
                allResults = allResults.filter(r => r.type === 'document');
            } else if (this._currentCategory === 'settings') {
                allResults = allResults.filter(r => r.type === 'setting');
            }
        }

        this._results = allResults.slice(0, maxResults);
        this._displayResults();
    }

    _searchSettings(text) {
        const results = [];
        for (const setting of SETTINGS_PANELS) {
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
                    score,
                    description: _('System Settings'),
                });
            }
        }
        return results;
    }

    _searchDocumentsAsync(text, generation, callback) {
        const docResults = [];
        this._pendingDocResults = docResults;

        if (text.length < 2) {
            callback();
            return;
        }

        const homeDir = GLib.get_home_dir();
        const searchFolderPaths = this._settings.get_strv('search-folders');
        const searchFileContent = this._settings.get_boolean('search-file-content');

        const searchDirs = searchFolderPaths.map(p => (p.startsWith('~') ? homeDir + p.substring(1) : p));

        let pendingDirs = searchDirs.length;
        if (pendingDirs === 0) {
            callback();
            return;
        }

        const finishOneDir = () => {
            pendingDirs--;
            if (pendingDirs <= 0) {
                if (!this._isDestroyed && this._searchGeneration === generation)
                    callback();
            }
        };

        for (const dirPath of searchDirs) {
            const dir = Gio.File.new_for_path(dirPath);

            let folderName = dirPath;
            if (dirPath.startsWith(homeDir))
                folderName = '~' + dirPath.substring(homeDir.length);

            dir.enumerate_children_async(
                'standard::name,standard::type,standard::icon,standard::content-type',
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_LOW,
                null,
                (source, res) => {
                    let enumerator = null;
                    let finished = false;
                    let count = 0;
                    const maxPerDir = 5;

                    const done = () => {
                        if (finished) return;
                        finished = true;
                        try { enumerator?.close(null); } catch (e) {}
                        finishOneDir();
                    };

                    const canceled = () =>
                        this._isDestroyed || this._searchGeneration !== generation;

                    const scoreAndMaybeAdd = (fileInfo) => {
                        const fileName = fileInfo.get_name();
                        if (!fileName || fileName.startsWith('.')) return;

                        const fileType = fileInfo.get_file_type();
                        if (fileType === Gio.FileType.DIRECTORY) return;

                        const fileNameLower = fileName.toLowerCase();
                        const isDocument = DOCUMENT_EXTENSIONS.some(ext => fileNameLower.endsWith(ext));
                        if (!isDocument) return;

                        let score = 0;
                        const nameWithoutExt = fileNameLower.replace(/\.[^/.]+$/, '');

                        if (nameWithoutExt === text) score = 90;
                        else if (nameWithoutExt.startsWith(text)) score = 70;
                        else if (nameWithoutExt.includes(text)) score = 50;
                        else if (fileNameLower.includes(text)) score = 30;

                        if (score === 0 && searchFileContent) {
                            const isTextFile = TEXT_EXTENSIONS.some(ext => fileNameLower.endsWith(ext));
                            if (isTextFile) {
                                // Schedule async file content search instead of blocking
                                const filePath = GLib.build_filenamev([dirPath, fileName]);
                                this._searchFileContentAsync(filePath, text, (found) => {
                                    if (!found) return;
                                    if (this._isDestroyed || this._searchGeneration !== generation) return;
                                    docResults.push({
                                        type: 'document',
                                        name: fileName,
                                        path: filePath,
                                        folder: folderName,
                                        icon: fileInfo.get_icon(),
                                        score: 25,
                                        description: folderName,
                                    });
                                    // Refresh display with new document result
                                    callback();
                                });
                                return;
                            }
                        }

                        if (score > 0) {
                            const filePath = GLib.build_filenamev([dirPath, fileName]);
                            docResults.push({
                                type: 'document',
                                name: fileName,
                                path: filePath,
                                folder: folderName,
                                icon: fileInfo.get_icon(),
                                score,
                                description: folderName,
                            });
                            count++;
                        }
                    };

                    const processNextBatch = () => {
                        if (canceled()) return done();
                        if (!enumerator) return done();
                        if (count >= maxPerDir) return done();

                        enumerator.next_files_async(
                            SEARCH_BATCH_SIZE,
                            GLib.PRIORITY_LOW,
                            null,
                            (enumSource, nextRes) => {
                                if (canceled()) return done();

                                let infos = null;
                                try {
                                    infos = enumSource.next_files_finish(nextRes);
                                } catch (e) {
                                    return done();
                                }

                                if (!infos || infos.length === 0)
                                    return done();

                                for (const info of infos) {
                                    if (canceled()) return done();
                                    if (count >= maxPerDir) return done();
                                    try { scoreAndMaybeAdd(info); } catch (e) {}
                                }

                                processNextBatch();
                            }
                        );
                    };

                    try {
                        enumerator = source.enumerate_children_finish(res);
                    } catch (e) {
                        return finishOneDir();
                    }

                    processNextBatch();
                }
            );
        }
    }

    _searchFileContentAsync(filePath, searchText, callback) {
        try {
            const file = Gio.File.new_for_path(filePath);
            file.query_info_async(
                'standard::size',
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_LOW,
                null,
                (source, res) => {
                    try {
                        const fileInfo = source.query_info_finish(res);
                        if (fileInfo.get_size() > MAX_FILE_SIZE_BYTES) {
                            callback(false);
                            return;
                        }

                        file.load_contents_async(null, (src, loadRes) => {
                            try {
                                const [success, contents] = src.load_contents_finish(loadRes);
                                if (!success) {
                                    callback(false);
                                    return;
                                }
                                const textContent = new TextDecoder('utf-8').decode(contents).toLowerCase();
                                callback(textContent.includes(searchText));
                            } catch (e) {
                                callback(false);
                            }
                        });
                    } catch (e) {
                        callback(false);
                    }
                }
            );
        } catch (e) {
            callback(false);
        }
    }

    // ========== Results Display ==========

    _displayResults() {
        // Cancel any in-flight display idle callback
        if (this._displayChunkId) {
            GLib.source_remove(this._displayChunkId);
            this._displayChunkId = null;
        }
        ++this._displayToken;
        this._cancelResultIcons();

        // Hide the box BEFORE destroying children to prevent the layout
        // system from doing an expensive recalculation on the now-empty
        // container (which sits inside a ScrollView).
        this._resultsBox.hide();
        this._resultsBox.destroy_all_children();
        this._resultButtons = [];
        this._selectedIndex = -1;

        if (this._results.length === 0) {
            this._noResultsLabel.show();
            return;
        }

        this._noResultsLabel.hide();

        // Single-pass display: with lazy St.Icon (set_gicon), widget creation
        // is cheap — no GPU textures until the compositor paints.
        if (this._currentCategory === 'all' && this._results.length > 0) {
            this._addBestMatch(this._results[0]);

            const remaining = this._results.slice(1);
            const groups = { app: [], setting: [], document: [] };
            for (const r of remaining) {
                if (groups[r.type]) groups[r.type].push(r);
            }

            if (groups.app.length > 0) {
                this._addGroupHeader(_('Apps'));
                for (const r of groups.app) this._addResultItem(r);
            }
            if (groups.setting.length > 0) {
                this._addGroupHeader(_('Settings'));
                for (const r of groups.setting) this._addResultItem(r);
            }
            if (groups.document.length > 0) {
                this._addGroupHeader(_('Documents'));
                for (const r of groups.document) this._addResultItem(r);
            }
        } else {
            for (const r of this._results) {
                this._addResultItem(r);
            }
        }

        // Show the fully-populated box in one shot (single layout pass)
        this._resultsBox.show();

        // Start loading real app icons via idle callbacks so texture
        // loading (disk I/O + decode) is spread across frames.
        this._processIconQueue('_resultIconQueue', '_resultIconSourceId');

        if (this._resultButtons.length > 0) {
            this._selectedIndex = 0;
            this._resultButtons[0].add_style_class_name('selected');
        }
    }

    _addBestMatch(result) {
        const section = new St.BoxLayout({
            style_class: 'winbar-search-best-match',
            vertical: true,
            x_expand: true,
        });

        section.add_child(new St.Label({
            text: _('Best match'),
            style_class: 'winbar-search-best-match-label',
        }));

        const item = new St.Button({
            style_class: 'winbar-search-result-item-dialog',
            x_expand: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        const box = new St.BoxLayout({
            style_class: 'winbar-search-result-box-dialog',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.set_child(box);

        // Icon (48px for best match)
        const icon = this._createResultIcon(result, 48);
        icon.set_y_align(Clutter.ActorAlign.CENTER);
        box.add_child(icon);

        const textBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(textBox);

        textBox.add_child(new St.Label({
            text: result.name,
            style_class: 'winbar-search-best-match-name',
        }));

        if (result.description) {
            const descLabel = new St.Label({
                text: result.description,
                style_class: 'winbar-search-best-match-description',
            });
            descLabel.clutter_text.set_ellipsize(3);
            textBox.add_child(descLabel);
        }

        item._result = result;
        item.connect('clicked', () => {
            this._activateResult(result);
        });

        section.add_child(item);
        this._resultsBox.add_child(section);
        this._resultButtons.push(item);
    }

    _addGroupHeader(title) {
        const label = new St.Label({
            text: title,
            style_class: 'winbar-search-group-header',
        });
        this._resultsBox.add_child(label);
    }

    _addResultItem(result) {
        const item = new St.Button({
            style_class: 'winbar-search-result-item-dialog',
            x_expand: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        const box = new St.BoxLayout({
            style_class: 'winbar-search-result-box-dialog',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.set_child(box);

        const icon = this._createResultIcon(result, 32);
        icon.set_y_align(Clutter.ActorAlign.CENTER);
        box.add_child(icon);

        const textBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(textBox);

        textBox.add_child(new St.Label({
            text: result.name,
            style_class: 'winbar-search-result-name-dialog',
        }));

        if (result.description) {
            const descLabel = new St.Label({
                text: result.description,
                style_class: 'winbar-search-result-description-dialog',
            });
            descLabel.clutter_text.set_ellipsize(3);
            textBox.add_child(descLabel);
        }

        item._result = result;
        item.connect('clicked', () => {
            this._activateResult(result);
        });

        this._resultsBox.add_child(item);
        this._resultButtons.push(item);
    }

    _createResultIcon(result, size) {
        if (result.type === 'app' && result.app) {
            const icon = new St.Icon({
                icon_name: 'application-x-executable-symbolic',
                icon_size: size,
                style_class: 'winbar-search-result-icon-dialog',
            });
            const gicon = result.gicon;
            if (gicon) this._resultIconQueue.push({ icon, gicon });
            return icon;
        } else if (result.type === 'setting') {
            return new St.Icon({
                icon_name: result.icon || 'preferences-system-symbolic',
                icon_size: size,
                style_class: 'winbar-search-result-icon-dialog',
            });
        } else if (result.type === 'document') {
            if (result.icon) {
                return new St.Icon({
                    gicon: result.icon,
                    icon_size: size,
                    style_class: 'winbar-search-result-icon-dialog',
                });
            }
            return new St.Icon({
                icon_name: 'text-x-generic-symbolic',
                icon_size: size,
                style_class: 'winbar-search-result-icon-dialog',
            });
        }
        return new St.Icon({
            icon_name: 'application-x-executable-symbolic',
            icon_size: size,
            style_class: 'winbar-search-result-icon-dialog',
        });
    }

    // ========== Result Activation ==========

    _activateResult(result) {
        if (result.type === 'app' && result.app) {
            result.app.activate();
            this._recordSearchSelection(this._currentSearchQuery, result.app.get_id());
        } else if (result.type === 'setting') {
            try {
                GLib.spawn_command_line_async(`gnome-control-center ${result.panel}`);
            } catch (e) {
                log(`[Winbar] Failed to open settings: ${e.message}`);
            }
        } else if (result.type === 'document' && result.path) {
            try {
                const file = Gio.File.new_for_path(result.path);
                Gio.AppInfo.launch_default_for_uri(file.get_uri(), null);
            } catch (e) {
                log(`[Winbar] Failed to open document: ${e.message}`);
            }
        }
        this.close();
    }

    _activateSelected() {
        if (this._selectedIndex >= 0 && this._selectedIndex < this._resultButtons.length) {
            const item = this._resultButtons[this._selectedIndex];
            if (item._result) {
                this._activateResult(item._result);
            }
        }
    }

    // ========== Category Handling ==========

    _onCategoryClicked(clickedBtn) {
        // Radio behavior: uncheck all others
        for (const btn of this._categoryButtons) {
            if (btn !== clickedBtn) {
                btn.set_checked(false);
            }
        }
        clickedBtn.set_checked(true);
        this._currentCategory = clickedBtn._categoryId;

        // Re-run search if there's a query
        if (this._query && this._query.length > 0) {
            this._performSearch(this._query.toLowerCase());
        }
    }

    // ========== Keyboard Navigation ==========

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();

        switch (symbol) {
            case Clutter.KEY_Escape:
                if (this._searchEntry.get_text().length > 0) {
                    this._searchEntry.set_text('');
                } else {
                    this.close();
                }
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Down:
            case Clutter.KEY_Tab:
                this._moveSelection(1);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Up:
                this._moveSelection(-1);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter:
                this._activateSelected();
                return Clutter.EVENT_STOP;

            default:
                // If not focused on search entry, redirect focus there
                if (!this._searchEntry.has_key_focus()) {
                    global.stage.set_key_focus(this._searchEntry);
                }
                return Clutter.EVENT_PROPAGATE;
        }
    }

    _moveSelection(delta) {
        if (this._resultButtons.length === 0) return;

        // Remove current selection
        if (this._selectedIndex >= 0 && this._selectedIndex < this._resultButtons.length) {
            this._resultButtons[this._selectedIndex].remove_style_class_name('selected');
        }

        // Calculate new index
        this._selectedIndex += delta;
        if (this._selectedIndex < 0) {
            this._selectedIndex = this._resultButtons.length - 1;
        } else if (this._selectedIndex >= this._resultButtons.length) {
            this._selectedIndex = 0;
        }

        // Apply new selection
        const newItem = this._resultButtons[this._selectedIndex];
        newItem.add_style_class_name('selected');

        // Scroll into view
        try {
            const vAdjust = this._contentScroll.get_vadjustment();
            const [, itemY] = newItem.get_transformed_position();
            const [, scrollY] = this._contentScroll.get_transformed_position();
            const scrollHeight = this._contentScroll.get_height();
            const itemHeight = newItem.get_height();

            const relativeY = itemY - scrollY;

            if (relativeY < 0) {
                vAdjust.set_value(vAdjust.get_value() + relativeY);
            } else if (relativeY + itemHeight > scrollHeight) {
                vAdjust.set_value(vAdjust.get_value() + relativeY + itemHeight - scrollHeight);
            }
        } catch (e) {
            // Ignore scroll errors
        }
    }

    // ========== View Switching ==========

    _showOverview() {
        this._cancelResultIcons();
        if (this._topAppsPopulateId) { GLib.source_remove(this._topAppsPopulateId); this._topAppsPopulateId = null; }
        if (this._recentPopulateId) { GLib.source_remove(this._recentPopulateId); this._recentPopulateId = null; }
        if (this._quickLinksPopulateId) { GLib.source_remove(this._quickLinksPopulateId); this._quickLinksPopulateId = null; }
        if (this._displayChunkId) { GLib.source_remove(this._displayChunkId); this._displayChunkId = null; }

        // Cancel any in-flight async search
        this._searchGeneration++;
        this._displayToken++;
        this._resultsBox.hide();
        this._resultsBox.destroy_all_children();
        this._noResultsLabel.hide();
        this._overviewBox.show();
        this._resultButtons = [];
        this._selectedIndex = -1;
        this._results = [];

        // Load any pending overview icons now that the overview is visible
        if (this._overviewIconQueue.length > 0) {
            this._processIconQueue('_overviewIconQueue', '_overviewIconSourceId', 2);
        }
    }

    // ========== Public API ==========

    setSearchText(text) {
        if (this._isOpen && !this._syncingText) {
            this._syncingText = true;
            this._searchEntry.set_text(text);
            this._syncingText = false;
            // text-changed handler is blocked by the sync guard above,
            // so we must trigger the search ourselves
            this._onSearchTextChanged();
        }
    }

    // ========== Open / Close ==========

    open() {
        if (this._isOpen) return;
        this._isOpen = true;

        // Cheap reset
        this._showOverview();
        this._searchEntry.set_text('');
        this._currentCategory = 'all';
        for (const btn of this._categoryButtons)
            btn.set_checked(btn._categoryId === 'all');

        // Position BEFORE showing — if the widget becomes visible at the old
        // offscreen coordinates without a valid allocation, Mutter spams
        // "Can't update stage views ... needs an allocation" warnings.
        this._positionDialog();

        this._container.opacity = 0;
        this._container.translation_y = 20;
        this.opacity = 255;
        this.show();

        // Start animation
        GLib.timeout_add(GLib.PRIORITY_HIGH, ANIMATION_FRAME_DELAY, () => {
            if (!this._isOpen || this._isDestroyed) return GLib.SOURCE_REMOVE;
            this._container.remove_all_transitions();
            this._container.ease({
            opacity: 255,
            translation_y: 0,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._isDestroyed) global.stage.set_key_focus(this._searchEntry);
            },
            });
            return GLib.SOURCE_REMOVE;
        });

        // Repopulate overview only if something changed (e.g. app installed/removed).
        // Overview is pre-built in constructor, so first open has zero widget cost.
        if (this._overviewDirty) {
            this._populateOverview();
        }

        // Kick off deferred icon loading for overview icons that haven't
        // been loaded yet (e.g. first open, or after dirty repopulation).
        // Use batch=2 to keep each frame's texture-load cost low.
        if (this._overviewIconQueue.length > 0) {
            this._processIconQueue('_overviewIconQueue', '_overviewIconSourceId', 2);
        }

        // Click-outside handler
        this._capturedEventId = global.stage.connect('captured-event', (actor, event) => {
            if (event.type() !== Clutter.EventType.BUTTON_PRESS) return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();

            // Check if inside dialog container
            const [dx, dy] = this._container.get_transformed_position();
            const [dw, dh] = this._container.get_size();
            if (x >= dx && x <= dx + dw && y >= dy && y <= dy + dh) return Clutter.EVENT_PROPAGATE;

            // Check if on search button
            if (this._searchButton) {
                const [sx, sy] = this._searchButton.get_transformed_position();
                const [sw, sh] = this._searchButton.get_size();
                if (x >= sx && x <= sx + sw && y >= sy && y <= sy + sh) return Clutter.EVENT_PROPAGATE;
            }

            this.close();
            return Clutter.EVENT_STOP;
        });

        // Close on window focus change
        this._focusWindowChangedId = global.display.connect('notify::focus-window', () => {
            if (global.display.get_focus_window() && this._isOpen) {
                this.close();
            }
        });

        // Close on overview showing
        this._overviewShowingId = Main.overview.connect('showing', () => {
            if (this._isOpen) {
                this.close();
            }
        });
    }

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;

        // Cancel deferred icon loading and pending tasks
        this._cancelResultIcons();
        if (this._topAppsPopulateId) { GLib.source_remove(this._topAppsPopulateId); this._topAppsPopulateId = null; }
        if (this._recentPopulateId) { GLib.source_remove(this._recentPopulateId); this._recentPopulateId = null; }
        if (this._quickLinksPopulateId) { GLib.source_remove(this._quickLinksPopulateId); this._quickLinksPopulateId = null; }
        if (this._displayChunkId) { GLib.source_remove(this._displayChunkId); this._displayChunkId = null; }
        this._overviewPopulateToken++;
        this._displayToken++;

        // Cancel any in-flight async search
        this._searchGeneration++;

        // Remove debounce timeout
        if (this._debounceTimeoutId) {
            GLib.source_remove(this._debounceTimeoutId);
            this._debounceTimeoutId = null;
        }

        // Disconnect handlers
        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = null;
        }
        if (this._focusWindowChangedId) {
            global.display.disconnect(this._focusWindowChangedId);
            this._focusWindowChangedId = null;
        }
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = null;
        }

        // Reset state
        this._query = '';
        this._results = [];
        this._selectedIndex = -1;
        this._resultButtons = [];
        this._pendingAppResults = [];
        this._pendingSettingsResults = [];
        this._pendingDocResults = [];

        // Animate fade out
        this._container.remove_all_transitions();
        this._container.ease({
            opacity: 0,
            translation_y: 20,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                try {
                    if (!this._isDestroyed) {
                        this.hide();
                        this._container.translation_y = 0;
                        this._container.opacity = 255;
                        this.set_position(-10000, -10000);
                    }
                } catch (e) {
                    // Widget may have been disposed
                }
            },
        });

        // Clear taskbar entry
        if (this._searchButton) {
            this._searchButton.clearEntry();
        }
    }

    // ========== Positioning ==========

    _positionDialog() {
        // Use the CSS-defined dimensions instead of get_preferred_height/width
        // which triggers an expensive full recursive layout calculation that
        // blocks the compositor main thread.
        // Values: content (620×640) + padding (20×2) + border (1×2)
        const menuWidth = 662;
        const menuHeight = 682;
        const monitor = this._winbar?._monitor || Main.layoutManager.primaryMonitor;

        // Give the widget an explicit size so Mutter can always compute
        // which stage views (monitors) it belongs to without waiting for
        // a layout pass.  This prevents the "Can't update stage views ...
        // needs an allocation" warnings.
        this.set_size(menuWidth, menuHeight);

        if (this._searchButton) {
            const [btnX, btnY] = this._searchButton.get_transformed_position();
            const [btnW] = this._searchButton.get_size();

            let x = btnX + btnW / 2 - menuWidth / 2;
            let y = btnY - menuHeight - MENU_OFFSET_PX;

            // Clamp to monitor bounds
            x = Math.max(monitor.x + MENU_SCREEN_PADDING_PX, x);
            x = Math.min(monitor.x + monitor.width - menuWidth - MENU_SCREEN_PADDING_PX, x);
            y = Math.max(monitor.y + MENU_SCREEN_PADDING_PX, y);

            this.set_position(x, y);
        } else {
            const x = monitor.x + (monitor.width - menuWidth) / 2;
            const y = monitor.y + (monitor.height - menuHeight) / 2;
            this.set_position(x, y);
        }
    }

    // ========== Theme ==========

    _applyTheme() {
        const effectiveMode = getEffectiveThemeMode(this._settings);
        const isLight = effectiveMode === 2;
        this._lastThemeMode = effectiveMode;
        const colors = isLight ? THEME_COLORS.light : THEME_COLORS.dark;

        this._container.set_style(`
            background-color: ${colors.bg};
            border-radius: 12px;
            border: 1px solid ${colors.border};
            box-shadow: ${colors.boxShadow};
            padding: 20px;
            min-width: 620px;
            min-height: 400px;
            max-height: 640px;
        `);

        if (isLight) {
            this.add_style_class_name('winbar-search-dialog-light');
        } else {
            this.remove_style_class_name('winbar-search-dialog-light');
        }
    }

    // ========== Destroy ==========

    destroy() {
        this._isDestroyed = true;

        // Disconnect signals
        if (this._installedChangedId) {
            Shell.AppSystem.get_default().disconnect(this._installedChangedId);
            this._installedChangedId = null;
        }
        if (this._synonymsChangedId) {
            this._settings.disconnect(this._synonymsChangedId);
            this._synonymsChangedId = null;
        }
        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = null;
        }
        if (this._focusWindowChangedId) {
            global.display.disconnect(this._focusWindowChangedId);
            this._focusWindowChangedId = null;
        }
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = null;
        }
        if (this._debounceTimeoutId) {
            GLib.source_remove(this._debounceTimeoutId);
            this._debounceTimeoutId = null;
        }

        // Remove chrome
        try {
            this.hide();
            Main.layoutManager.removeChrome(this);
        } catch (e) {
            // May already be removed
        }

        // Remove any pending populate tasks and deferred icon loads
        this._cancelResultIcons();
        this._cancelOverviewIcons();
        if (this._topAppsPopulateId) { GLib.source_remove(this._topAppsPopulateId); this._topAppsPopulateId = null; }
        if (this._recentPopulateId) { GLib.source_remove(this._recentPopulateId); this._recentPopulateId = null; }
        if (this._quickLinksPopulateId) { GLib.source_remove(this._quickLinksPopulateId); this._quickLinksPopulateId = null; }
        if (this._displayChunkId) { GLib.source_remove(this._displayChunkId); this._displayChunkId = null; }
        this._overviewPopulateToken++;

        // Null references
        this._extension = null;
        this._settings = null;
        this._searchButton = null;
        this._winbar = null;
        this._cachedApps = null;
        this._searchLearning = null;
        this._searchSynonyms = null;
        this._appToSynonyms = null;
        this._resultButtons = null;
        this._results = null;
        this._categoryButtons = null;

        super.destroy();
    }
});
