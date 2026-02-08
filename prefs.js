/**
 * Winbar - Preferences Dialog
 * 
 * Settings UI for the Winbar GNOME Shell extension
 * Uses GTK4 and libadwaita for GNOME 45+
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { DEFAULT_SEARCH_SYNONYMS } from './src/constants.js';

export default class WinbarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Set window properties
        window.set_default_size(700, 800);
        window.set_title(_('Winbar Settings'));

        // Create pages
        this._createAppearancePage(window, settings);
        this._createElementsPage(window, settings);
        this._createBehaviorPage(window, settings);
        this._createSearchPage(window, settings);
        this._createSpacingPage(window, settings);
        this._createAdvancedPage(window, settings);
    }

    _createAppearancePage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'applications-graphics-symbolic',
        });
        window.add(page);

        // Position & Size Group
        const positionGroup = new Adw.PreferencesGroup({
            title: _('Position &amp; Size'),
            description: _('Configure taskbar position and dimensions'),
        });
        page.add(positionGroup);

        // Taskbar Position
        const positionRow = new Adw.ComboRow({
            title: _('Taskbar Position'),
            subtitle: _('Where to place the taskbar'),
        });
        positionRow.set_model(new Gtk.StringList({ strings: [_('Bottom'), _('Top')] }));
        positionRow.set_selected(settings.get_enum('taskbar-position'));
        positionRow.connect('notify::selected', (row) => {
            settings.set_enum('taskbar-position', row.selected);
        });
        positionGroup.add(positionRow);

        // Taskbar Height
        const heightRow = new Adw.SpinRow({
            title: _('Taskbar Height'),
            subtitle: _('Height in pixels (32-64)'),
            adjustment: new Gtk.Adjustment({
                lower: 32,
                upper: 64,
                step_increment: 2,
                value: settings.get_int('taskbar-height'),
            }),
        });
        heightRow.connect('notify::value', (row) => {
            settings.set_int('taskbar-height', row.value);
        });
        positionGroup.add(heightRow);

        // Icon Size
        const iconSizeRow = new Adw.SpinRow({
            title: _('Icon Size'),
            subtitle: _('Size of app icons in pixels (16-48)'),
            adjustment: new Gtk.Adjustment({
                lower: 16,
                upper: 48,
                step_increment: 2,
                value: settings.get_int('icon-size'),
            }),
        });
        iconSizeRow.connect('notify::value', (row) => {
            settings.set_int('icon-size', row.value);
        });
        positionGroup.add(iconSizeRow);

        // Theme Group
        const themeGroup = new Adw.PreferencesGroup({
            title: _('Theme'),
            description: _('Appearance and visual style'),
        });
        page.add(themeGroup);

        // Theme Mode
        const themeModeRow = new Adw.ComboRow({
            title: _('Theme Mode'),
            subtitle: _('Color scheme for the taskbar'),
        });
        themeModeRow.set_model(new Gtk.StringList({ strings: [_('Auto'), _('Dark'), _('Light')] }));
        themeModeRow.set_selected(settings.get_enum('theme-mode'));
        themeModeRow.connect('notify::selected', (row) => {
            settings.set_enum('theme-mode', row.selected);
        });
        themeGroup.add(themeModeRow);

        // Panel Opacity
        const opacityRow = new Adw.SpinRow({
            title: _('Panel Opacity'),
            subtitle: _('Transparency level (0-100)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 5,
                value: settings.get_int('panel-opacity'),
            }),
        });
        opacityRow.connect('notify::value', (row) => {
            settings.set_int('panel-opacity', row.value);
        });
        themeGroup.add(opacityRow);

        // Border Radius
        const radiusRow = new Adw.SpinRow({
            title: _('Border Radius'),
            subtitle: _('Corner roundness (0-20)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 1,
                value: settings.get_int('border-radius'),
            }),
        });
        radiusRow.connect('notify::value', (row) => {
            settings.set_int('border-radius', row.value);
        });
        themeGroup.add(radiusRow);

        // Blur Effect
        const blurRow = new Adw.SwitchRow({
            title: _('Blur Effect'),
            subtitle: _('Enable background blur'),
        });
        settings.bind('blur-effect', blurRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        themeGroup.add(blurRow);

        // Blur Strength
        const blurStrengthRow = new Adw.SpinRow({
            title: _('Blur Strength'),
            subtitle: _('Intensity of the blur effect (0-100)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 5,
                value: settings.get_int('blur-strength'),
            }),
        });
        blurStrengthRow.connect('notify::value', (row) => {
            settings.set_int('blur-strength', row.value);
        });
        themeGroup.add(blurStrengthRow);
    }

    _createElementsPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Elements'),
            icon_name: 'view-grid-symbolic',
        });
        window.add(page);

        // Left Section Group
        const leftGroup = new Adw.PreferencesGroup({
            title: _('Left Section'),
            description: _('Elements on the left side'),
        });
        page.add(leftGroup);

        // Show Widgets
        const widgetsRow = new Adw.SwitchRow({
            title: _('Show Widgets'),
            subtitle: _('Weather and widgets panel'),
        });
        settings.bind('show-widgets', widgetsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        leftGroup.add(widgetsRow);

        // Center Section Group
        const centerGroup = new Adw.PreferencesGroup({
            title: _('Center Section'),
            description: _('Main taskbar elements'),
        });
        page.add(centerGroup);
/*
        // Show Start Button
        const startRow = new Adw.SwitchRow({
            title: _('Show Start Button'),
            subtitle: _('Start menu button'),
        });
        settings.bind('show-start-button', startRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        centerGroup.add(startRow);

        // Start Button Style
        const startStyleRow = new Adw.ComboRow({
            title: _('Start Button Style'),
            subtitle: _('Icon style for start button'),
        });
        startStyleRow.set_model(new Gtk.StringList({ strings: [_('Default'), _('GNOME'), _('Custom')] }));
        startStyleRow.set_selected(settings.get_enum('start-button-style'));
        startStyleRow.connect('notify::selected', (row) => {
            settings.set_enum('start-button-style', row.selected);
        });
        centerGroup.add(startStyleRow);
*/
// Start Button Customization Group

        // Start Button Style
        const startStyleRow = new Adw.ComboRow({
            title: _('Start Button Style'),
            subtitle: _('Icon style for the start button'),
        });
        startStyleRow.set_model(new Gtk.StringList({
            strings: [_('Default'), _('GNOME'), _('Custom')]
        }));
        startStyleRow.set_selected(settings.get_enum('start-button-style'));
        startStyleRow.connect('notify::selected', (row) => {
            settings.set_enum('start-button-style', row.selected);
        });
        centerGroup.add(startStyleRow);

        // Custom Start Icon
        const customIconRow = new Adw.ActionRow({
            title: _('Custom Icon Path'),
            subtitle: settings.get_string('custom-start-icon') || _('No icon selected'),
        });

        const chooseButton = new Gtk.Button({
            label: _('Choose File'),
            valign: Gtk.Align.CENTER,
        });

        chooseButton.connect('clicked', () => {
            const fileDialog = new Gtk.FileDialog({
                title: _('Select Icon File'),
            });

            // Set up file filter for images
            const imageFilter = new Gtk.FileFilter();
            imageFilter.set_name(_('Image Files'));
            imageFilter.add_mime_type('image/png');
            imageFilter.add_mime_type('image/svg+xml');
            imageFilter.add_mime_type('image/jpeg');
            imageFilter.add_mime_type('image/gif');
            imageFilter.add_pattern('*.png');
            imageFilter.add_pattern('*.svg');
            imageFilter.add_pattern('*.jpg');
            imageFilter.add_pattern('*.jpeg');
            imageFilter.add_pattern('*.gif');

            const filterList = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filterList.append(imageFilter);
            fileDialog.set_filters(filterList);
            fileDialog.set_default_filter(imageFilter);

            // Open the file chooser
            fileDialog.open(customIconRow.get_root(), null, (dialog, result) => {
                try {
                    const file = dialog.open_finish(result);
                    if (file) {
                        const path = file.get_path();
                        settings.set_string('custom-start-icon', path);
                        customIconRow.set_subtitle(path);
                    }
                } catch (e) {
                    if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) {
                        log(`[Winbar] Error selecting file: ${e.message}`);
                    }
                }
            });
        });

        customIconRow.add_suffix(chooseButton);
        customIconRow.set_activatable_widget(chooseButton);
        centerGroup.add(customIconRow);

        // Update subtitle when setting changes
        settings.connect('changed::custom-start-icon', () => {
            const path = settings.get_string('custom-start-icon');
            customIconRow.set_subtitle(path || _('No icon selected'));
        });

        // Show Search
        const searchRow = new Adw.SwitchRow({
            title: _('Show Search'),
            subtitle: _('Search bar or icon'),
        });
        settings.bind('show-search', searchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        centerGroup.add(searchRow);

        // Search Style
        const searchStyleRow = new Adw.ComboRow({
            title: _('Search Style'),
            subtitle: _('How the search is displayed'),
        });
        searchStyleRow.set_model(new Gtk.StringList({ strings: [_('Box with Label'), _('Icon Only'), _('Hidden')] }));
        searchStyleRow.set_selected(settings.get_enum('search-style'));
        searchStyleRow.connect('notify::selected', (row) => {
            settings.set_enum('search-style', row.selected);
        });
        centerGroup.add(searchStyleRow);

        // Use Native Search
        const nativeSearchRow = new Adw.SwitchRow({
            title: _('Use Native Search'),
            subtitle: _('Open GNOME\'s built-in search instead of Winbar\'s dialog'),
        });
        settings.bind('use-native-search', nativeSearchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        centerGroup.add(nativeSearchRow);

        // Show Task View
        const taskViewRow = new Adw.SwitchRow({
            title: _('Show Task View'),
            subtitle: _('Task view / Activities button'),
        });
        settings.bind('show-task-view', taskViewRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        centerGroup.add(taskViewRow);

        // Center Taskbar Items
        const centerItemsRow = new Adw.SwitchRow({
            title: _('Center App Icons'),
            subtitle: _('Center the app icons in the taskbar'),
        });
        settings.bind('center-taskbar-items', centerItemsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        centerGroup.add(centerItemsRow);

        // Right Section Group
        const rightGroup = new Adw.PreferencesGroup({
            title: _('Right Section'),
            description: _('System tray and clock'),
        });
        page.add(rightGroup);

        // Show System Tray
        const trayRow = new Adw.SwitchRow({
            title: _('Show System Tray'),
            subtitle: _('Network, volume, battery indicators'),
        });
        settings.bind('show-system-tray', trayRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        rightGroup.add(trayRow);

        // Tray Icon Limit
        const trayLimitRow = new Adw.SpinRow({
            title: _('Visible Tray Icons'),
            subtitle: _('Icons before overflow (2-10)'),
            adjustment: new Gtk.Adjustment({
                lower: 2,
                upper: 10,
                step_increment: 1,
                value: settings.get_int('tray-icon-limit'),
            }),
        });
        trayLimitRow.connect('notify::value', (row) => {
            settings.set_int('tray-icon-limit', row.value);
        });
        rightGroup.add(trayLimitRow);

        // Use Native Quick Settings
        const nativeQsRow = new Adw.SwitchRow({
            title: _('Use Native Quick Settings'),
            subtitle: _('Open GNOME\'s panel instead of Winbar\'s popup'),
        });
        settings.bind('use-native-quick-settings', nativeQsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        rightGroup.add(nativeQsRow);

        // Use Native Notification Center
        const nativeNotifRow = new Adw.SwitchRow({
            title: _('Use Native Notification Center'),
            subtitle: _('Open GNOME\'s calendar/notifications instead of Winbar\'s popup'),
        });
        settings.bind('use-native-notifications', nativeNotifRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        rightGroup.add(nativeNotifRow);

        // Show Clock
        const clockRow = new Adw.SwitchRow({
            title: _('Show Clock'),
            subtitle: _('Time display'),
        });
        settings.bind('show-clock', clockRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        rightGroup.add(clockRow);

        // Clock Format
        const clockFormatRow = new Adw.ComboRow({
            title: _('Clock Format'),
            subtitle: _('Time format'),
        });
        clockFormatRow.set_model(new Gtk.StringList({ strings: [_('24-hour'), _('12-hour')] }));
        clockFormatRow.set_selected(settings.get_enum('clock-format'));
        clockFormatRow.connect('notify::selected', (row) => {
            settings.set_enum('clock-format', row.selected);
        });
        rightGroup.add(clockFormatRow);

        // Show Date
        const dateRow = new Adw.SwitchRow({
            title: _('Show Date'),
            subtitle: _('Display date below time'),
        });
        settings.bind('show-date', dateRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        rightGroup.add(dateRow);

        // Show Notifications
        const notifRow = new Adw.SwitchRow({
            title: _('Show Notifications'),
            subtitle: _('Notification center button'),
        });
        settings.bind('show-notifications', notifRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        rightGroup.add(notifRow);

        // Show Desktop Button
        const desktopRow = new Adw.SwitchRow({
            title: _('Show Desktop Button'),
            subtitle: _('Peek / show desktop area'),
        });
        settings.bind('show-show-desktop', desktopRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        rightGroup.add(desktopRow);
    }

    _createBehaviorPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Behavior'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // Panel Behavior Group
        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel'),
            description: _('General panel behavior'),
        });
        page.add(panelGroup);

        // Hide Original Panel
        const hidePanelRow = new Adw.SwitchRow({
            title: _('Hide GNOME Panel'),
            subtitle: _('Hide the default top panel'),
        });
        settings.bind('hide-original-panel', hidePanelRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(hidePanelRow);

        // Click Behavior Group
        const clickGroup = new Adw.PreferencesGroup({
            title: _('Click Actions'),
            description: _('How app icons respond to clicks'),
        });
        page.add(clickGroup);

        // Click Behavior
        const clickBehaviorRow = new Adw.ComboRow({
            title: _('Click Behavior'),
            subtitle: _('Action when clicking an app icon'),
        });
        clickBehaviorRow.set_model(new Gtk.StringList({ 
            strings: [_('Smart'), _('Raise'), _('Preview'), _('Cycle Windows')] 
        }));
        clickBehaviorRow.set_selected(settings.get_enum('click-behavior'));
        clickBehaviorRow.connect('notify::selected', (row) => {
            settings.set_enum('click-behavior', row.selected);
        });
        clickGroup.add(clickBehaviorRow);

        // Middle Click Action
        const middleClickRow = new Adw.ComboRow({
            title: _('Middle Click Action'),
            subtitle: _('Action when middle-clicking an app icon'),
        });
        middleClickRow.set_model(new Gtk.StringList({
            strings: [_('Open New Window'), _('Close Window'), _('Minimize All')]
        }));
        const middleClickAction = settings.get_string('middle-click-action');
        const middleClickIndex = middleClickAction === 'close-window' ? 1 :
                                  middleClickAction === 'minimize' ? 2 : 0;
        middleClickRow.set_selected(middleClickIndex);
        middleClickRow.connect('notify::selected', (row) => {
            const actions = ['new-window', 'close-window', 'minimize'];
            settings.set_string('middle-click-action', actions[row.selected]);
        });
        clickGroup.add(middleClickRow);

        // Scroll Action
        const scrollActionRow = new Adw.ComboRow({
            title: _('Scroll Action'),
            subtitle: _('Action when scrolling on an app icon'),
        });
        scrollActionRow.set_model(new Gtk.StringList({
            strings: [_('Cycle Windows'), _('Launch App'), _('None')]
        }));
        const scrollAction = settings.get_string('scroll-action');
        const scrollIndex = scrollAction === 'launch' ? 1 :
                           scrollAction === 'none' ? 2 : 0;
        scrollActionRow.set_selected(scrollIndex);
        scrollActionRow.connect('notify::selected', (row) => {
            const actions = ['cycle-windows', 'launch', 'none'];
            settings.set_string('scroll-action', actions[row.selected]);
        });
        clickGroup.add(scrollActionRow);

        // Window Previews Group
        const previewGroup = new Adw.PreferencesGroup({
            title: _('Window Previews'),
            description: _('Thumbnail preview settings'),
        });
        page.add(previewGroup);

        // Show Window Previews
        const previewRow = new Adw.SwitchRow({
            title: _('Show Window Previews'),
            subtitle: _('Show thumbnails on hover'),
        });
        settings.bind('show-window-previews', previewRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        previewGroup.add(previewRow);

        // Preview Hover Delay
        const previewDelayRow = new Adw.SpinRow({
            title: _('Hover Delay'),
            subtitle: _('Milliseconds before showing preview (100-1000)'),
            adjustment: new Gtk.Adjustment({
                lower: 100,
                upper: 1000,
                step_increment: 50,
                value: settings.get_int('preview-hover-delay'),
            }),
        });
        previewDelayRow.connect('notify::value', (row) => {
            settings.set_int('preview-hover-delay', row.value);
        });
        previewGroup.add(previewDelayRow);

        // App Grouping Group
        const groupingGroup = new Adw.PreferencesGroup({
            title: _('App Organization'),
            description: _('How apps are displayed'),
        });
        page.add(groupingGroup);

        // Group Apps
        const groupRow = new Adw.SwitchRow({
            title: _('Group Windows'),
            subtitle: _('Group windows by application'),
        });
        settings.bind('group-apps', groupRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        groupingGroup.add(groupRow);

        // Show Favorites
        const favoritesRow = new Adw.SwitchRow({
            title: _('Show Pinned Apps'),
            subtitle: _('Display favorite/pinned apps'),
        });
        settings.bind('show-favorites', favoritesRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        groupingGroup.add(favoritesRow);

        // Show Running Apps
        const runningRow = new Adw.SwitchRow({
            title: _('Show Running Apps'),
            subtitle: _('Show unpinned running apps'),
        });
        settings.bind('show-running-apps', runningRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        groupingGroup.add(runningRow);

        // Running Indicator Group
        const indicatorGroup = new Adw.PreferencesGroup({
            title: _('Running Indicator'),
            description: _('Visual indicator for running apps'),
        });
        page.add(indicatorGroup);

        // Indicator Style
        const indicatorStyleRow = new Adw.ComboRow({
            title: _('Indicator Style'),
            subtitle: _('Visual style of the running indicator'),
        });
        indicatorStyleRow.set_model(new Gtk.StringList({
            strings: [_('Dot'), _('Line'), _('Dash')]
        }));
        const indicatorStyle = settings.get_string('running-indicator-style');
        const styleIndex = indicatorStyle === 'line' ? 1 :
                          indicatorStyle === 'dash' ? 2 : 0;
        indicatorStyleRow.set_selected(styleIndex);
        indicatorStyleRow.connect('notify::selected', (row) => {
            const styles = ['dot', 'line', 'dash'];
            settings.set_string('running-indicator-style', styles[row.selected]);
        });
        indicatorGroup.add(indicatorStyleRow);

        // Indicator Position
        const indicatorPosRow = new Adw.ComboRow({
            title: _('Indicator Position'),
            subtitle: _('Where to show the running indicator'),
        });
        indicatorPosRow.set_model(new Gtk.StringList({
            strings: [_('Bottom'), _('Top'), _('Left'), _('Right')]
        }));
        const indicatorPos = settings.get_string('indicator-position');
        const posIndex = indicatorPos === 'top' ? 1 :
                        indicatorPos === 'left' ? 2 :
                        indicatorPos === 'right' ? 3 : 0;
        indicatorPosRow.set_selected(posIndex);
        indicatorPosRow.connect('notify::selected', (row) => {
            const positions = ['bottom', 'top', 'left', 'right'];
            settings.set_string('indicator-position', positions[row.selected]);
        });
        indicatorGroup.add(indicatorPosRow);
    }

    _createSearchPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Search'),
            icon_name: 'system-search-symbolic',
        });
        window.add(page);

        // Overview Panel Group
        const overviewGroup = new Adw.PreferencesGroup({
            title: _('Search Overview'),
            description: _('Configure what appears when opening search'),
        });
        page.add(overviewGroup);

        // Show Quick Links
        const quickLinksRow = new Adw.SwitchRow({
            title: _('Show Quick Links'),
            subtitle: _('Display quick settings links in overview'),
        });
        settings.bind('search-show-quick-links', quickLinksRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        overviewGroup.add(quickLinksRow);

        // Show Top Apps
        const topAppsRow = new Adw.SwitchRow({
            title: _('Show Top Apps'),
            subtitle: _('Display most used apps grid'),
        });
        settings.bind('search-show-top-apps', topAppsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        overviewGroup.add(topAppsRow);

        // Top Apps Count
        const topAppsCountRow = new Adw.SpinRow({
            title: _('Top Apps Count'),
            subtitle: _('Number of top apps to display (3-12)'),
            adjustment: new Gtk.Adjustment({
                lower: 3,
                upper: 12,
                step_increment: 1,
                value: settings.get_int('search-top-apps-count'),
            }),
        });
        topAppsCountRow.connect('notify::value', (row) => {
            settings.set_int('search-top-apps-count', row.value);
        });
        overviewGroup.add(topAppsCountRow);

        // Show Recent Apps
        const recentAppsRow = new Adw.SwitchRow({
            title: _('Show Recent Apps'),
            subtitle: _('Display recently used apps list'),
        });
        settings.bind('search-show-recent-apps', recentAppsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        overviewGroup.add(recentAppsRow);

        // Categories Group
        const categoriesGroup = new Adw.PreferencesGroup({
            title: _('Search Categories'),
            description: _('Enable or disable search categories'),
        });
        page.add(categoriesGroup);

        // Category All
        const catAllRow = new Adw.SwitchRow({
            title: _('All'),
            subtitle: _('Show All category filter'),
        });
        settings.bind('search-category-all', catAllRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        categoriesGroup.add(catAllRow);

        // Category Apps
        const catAppsRow = new Adw.SwitchRow({
            title: _('Apps'),
            subtitle: _('Show Apps category filter'),
        });
        settings.bind('search-category-apps', catAppsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        categoriesGroup.add(catAppsRow);

        // Category Documents
        const catDocsRow = new Adw.SwitchRow({
            title: _('Documents'),
            subtitle: _('Show Documents category filter'),
        });
        settings.bind('search-category-documents', catDocsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        categoriesGroup.add(catDocsRow);

        // Category Settings
        const catSettingsRow = new Adw.SwitchRow({
            title: _('Settings'),
            subtitle: _('Show Settings category filter'),
        });
        settings.bind('search-category-settings', catSettingsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        categoriesGroup.add(catSettingsRow);

        // Category Folders
        const catFoldersRow = new Adw.SwitchRow({
            title: _('Folders'),
            subtitle: _('Show Folders category filter'),
        });
        settings.bind('search-category-folders', catFoldersRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        categoriesGroup.add(catFoldersRow);

        // Category Web
        const catWebRow = new Adw.SwitchRow({
            title: _('Web'),
            subtitle: _('Show Web search category filter'),
        });
        settings.bind('search-category-web', catWebRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        categoriesGroup.add(catWebRow);

        // Search Sources Group
        const sourcesGroup = new Adw.PreferencesGroup({
            title: _('Search Sources'),
            description: _('What to include in search results'),
        });
        page.add(sourcesGroup);

        // Search Settings Panels
        const settingsRow = new Adw.SwitchRow({
            title: _('Search Settings'),
            subtitle: _('Include GNOME Settings panels in results'),
        });
        settings.bind('search-settings-panels', settingsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        sourcesGroup.add(settingsRow);

        // Search Documents
        const documentsRow = new Adw.SwitchRow({
            title: _('Search Documents'),
            subtitle: _('Include files from configured folders'),
        });
        settings.bind('search-documents', documentsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        sourcesGroup.add(documentsRow);

        // Search File Content
        const contentRow = new Adw.SwitchRow({
            title: _('Search File Contents'),
            subtitle: _('Search within text files (may be slower)'),
        });
        settings.bind('search-file-content', contentRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        sourcesGroup.add(contentRow);

        // Max Results
        const maxResultsRow = new Adw.SpinRow({
            title: _('Maximum Results'),
            subtitle: _('Maximum number of search results per category (5-20)'),
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 20,
                step_increment: 1,
                value: settings.get_int('search-max-results'),
            }),
        });
        maxResultsRow.connect('notify::value', (row) => {
            settings.set_int('search-max-results', row.value);
        });
        sourcesGroup.add(maxResultsRow);

        // Display Options Group
        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display Options'),
            description: _('Search results appearance'),
        });
        page.add(displayGroup);

        // Show Preview Pane
        const previewRow = new Adw.SwitchRow({
            title: _('Show Preview Pane'),
            subtitle: _('Display detailed preview of selected result'),
        });
        settings.bind('search-show-preview', previewRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(previewRow);

        // Search Folders Group
        const foldersGroup = new Adw.PreferencesGroup({
            title: _('Search Folders'),
            description: _('Folders to search for documents'),
        });
        page.add(foldersGroup);

        // Create a list box for folders
        this._folderListBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        foldersGroup.add(this._folderListBox);

        // Load existing folders
        const folders = settings.get_strv('search-folders');
        folders.forEach(folder => {
            this._addFolderRow(folder, settings);
        });

        // Add Folder Button
        const addFolderRow = new Adw.ActionRow({
            title: _('Add Folder'),
            subtitle: _('Add a new folder to search'),
        });

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });

        addButton.connect('clicked', () => {
            const folderDialog = new Gtk.FileDialog({
                title: _('Select Folder'),
            });

            folderDialog.select_folder(addFolderRow.get_root(), null, (dialog, result) => {
                try {
                    const folder = dialog.select_folder_finish(result);
                    if (folder) {
                        let path = folder.get_path();
                        const homeDir = GLib.get_home_dir();

                        // Convert to ~ notation if in home directory
                        if (path.startsWith(homeDir)) {
                            path = '~' + path.substring(homeDir.length);
                        }

                        // Add to settings if not already present
                        const currentFolders = settings.get_strv('search-folders');
                        if (!currentFolders.includes(path)) {
                            currentFolders.push(path);
                            settings.set_strv('search-folders', currentFolders);
                            this._addFolderRow(path, settings);
                        }
                    }
                } catch (e) {
                    if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) {
                        log(`[Winbar] Error selecting folder: ${e.message}`);
                    }
                }
            });
        });

        addFolderRow.add_suffix(addButton);
        addFolderRow.set_activatable_widget(addButton);
        foldersGroup.add(addFolderRow);

        // Quick Links Customization Group
        const quickLinksGroup = new Adw.PreferencesGroup({
            title: _('Quick Links Customization'),
            description: _('Configure which quick links appear in search overview'),
        });
        page.add(quickLinksGroup);

        // Create expander row for quick links
        const quickLinksExpander = new Adw.ExpanderRow({
            title: _('Manage Quick Links'),
            subtitle: _('Select which settings panels appear as quick links'),
        });
        quickLinksGroup.add(quickLinksExpander);

        // Available quick links
        const availableLinks = [
            { id: 'sound', label: _('Sound') },
            { id: 'network', label: _('Network') },
            { id: 'bluetooth', label: _('Bluetooth') },
            { id: 'display', label: _('Displays') },
            { id: 'power', label: _('Power') },
            { id: 'search', label: _('Settings') },
        ];

        const currentLinks = settings.get_strv('search-quick-links');

        availableLinks.forEach(link => {
            const linkRow = new Adw.ActionRow({
                title: link.label,
            });

            const linkSwitch = new Gtk.Switch({
                active: currentLinks.includes(link.id),
                valign: Gtk.Align.CENTER,
            });

            linkSwitch.connect('notify::active', (sw) => {
                const links = settings.get_strv('search-quick-links');
                if (sw.active) {
                    if (!links.includes(link.id)) {
                        links.push(link.id);
                    }
                } else {
                    const index = links.indexOf(link.id);
                    if (index > -1) {
                        links.splice(index, 1);
                    }
                }
                settings.set_strv('search-quick-links', links);
            });

            linkRow.add_suffix(linkSwitch);
            linkRow.set_activatable_widget(linkSwitch);
            quickLinksExpander.add_row(linkRow);
        });

        // Search Synonyms Group
        const synonymsGroup = new Adw.PreferencesGroup({
            title: _('Search Synonyms'),
            description: _('Custom keyword-to-app mappings for search'),
        });
        page.add(synonymsGroup);

        const synonymsRow = new Adw.ActionRow({
            title: _('Configure Synonyms'),
            subtitle: _('Add, edit, or remove search keyword mappings'),
        });

        const synonymsButton = new Gtk.Button({
            label: _('Configure'),
            valign: Gtk.Align.CENTER,
        });

        synonymsButton.connect('clicked', () => {
            this._openSynonymEditor(synonymsRow.get_root(), settings);
        });

        synonymsRow.add_suffix(synonymsButton);
        synonymsRow.set_activatable_widget(synonymsButton);
        synonymsGroup.add(synonymsRow);
    }

    _addFolderRow(folderPath, settings) {
        const row = new Adw.ActionRow({
            title: folderPath,
        });

        // Expand ~ for display subtitle
        let displayPath = folderPath;
        if (folderPath.startsWith('~')) {
            displayPath = GLib.get_home_dir() + folderPath.substring(1);
        }

        // Check if folder exists
        const file = Gio.File.new_for_path(displayPath);
        if (!file.query_exists(null)) {
            row.set_subtitle(_('Folder not found'));
            row.add_css_class('error');
        }

        // Remove button
        const removeButton = new Gtk.Button({
            icon_name: 'edit-delete-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'error'],
        });

        removeButton.connect('clicked', () => {
            const currentFolders = settings.get_strv('search-folders');
            const index = currentFolders.indexOf(folderPath);
            if (index > -1) {
                currentFolders.splice(index, 1);
                settings.set_strv('search-folders', currentFolders);
            }
            this._folderListBox.remove(row);
        });

        row.add_suffix(removeButton);
        this._folderListBox.append(row);
    }

    // ── Synonym Editor ─────────────────────────────────────

    _loadSynonyms(settings) {
        try {
            const data = settings.get_string('search-synonyms');
            if (data) return JSON.parse(data);
        } catch (e) { /* ignore */ }
        return JSON.parse(JSON.stringify(DEFAULT_SEARCH_SYNONYMS));
    }

    _saveSynonyms(settings, synonyms) {
        settings.set_string('search-synonyms', JSON.stringify(synonyms));
    }

    _openSynonymEditor(parent, settings) {
        const win = new Adw.Window({
            title: _('Search Synonyms'),
            default_width: 600,
            default_height: 500,
            modal: true,
            transient_for: parent,
        });

        const toolbarView = new Adw.ToolbarView();
        win.set_content(toolbarView);

        const headerBar = new Adw.HeaderBar();

        const resetButton = new Gtk.Button({
            label: _('Reset Defaults'),
        });
        resetButton.add_css_class('destructive-action');
        headerBar.pack_start(resetButton);

        toolbarView.add_top_bar(headerBar);

        const scrolled = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            vexpand: true,
        });
        toolbarView.set_content(scrolled);

        const clamp = new Adw.Clamp({
            maximum_size: 550,
        });
        scrolled.set_child(clamp);

        const mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            margin_start: 12,
            margin_end: 12,
            margin_top: 12,
            margin_bottom: 12,
            spacing: 12,
        });
        clamp.set_child(mainBox);

        const listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        mainBox.append(listBox);

        // Add button
        const addRow = new Adw.ActionRow({
            title: _('Add Synonym'),
        });
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        addRow.add_suffix(addButton);
        addRow.set_activatable_widget(addButton);

        const addListBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        addListBox.append(addRow);
        mainBox.append(addListBox);

        // Load and populate
        let synonyms = this._loadSynonyms(settings);

        const populateList = () => {
            // Remove all rows
            let child = listBox.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                listBox.remove(child);
                child = next;
            }

            const sortedKeys = Object.keys(synonyms).sort();
            for (const keyword of sortedKeys) {
                const apps = synonyms[keyword];
                const row = new Adw.ActionRow({
                    title: keyword,
                    subtitle: apps.join(', '),
                });
                row.add_css_class('property');

                const editBtn = new Gtk.Button({
                    icon_name: 'document-edit-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                });
                editBtn.connect('clicked', () => {
                    this._openSynonymEditDialog(win, keyword, apps, (newKeyword, newApps) => {
                        if (newKeyword !== keyword) {
                            delete synonyms[keyword];
                        }
                        synonyms[newKeyword] = newApps;
                        this._saveSynonyms(settings, synonyms);
                        populateList();
                    });
                });

                const deleteBtn = new Gtk.Button({
                    icon_name: 'edit-delete-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat', 'error'],
                });
                deleteBtn.connect('clicked', () => {
                    delete synonyms[keyword];
                    this._saveSynonyms(settings, synonyms);
                    populateList();
                });

                row.add_suffix(editBtn);
                row.add_suffix(deleteBtn);
                listBox.append(row);
            }
        };

        populateList();

        addButton.connect('clicked', () => {
            this._openSynonymEditDialog(win, '', [], (newKeyword, newApps) => {
                synonyms[newKeyword] = newApps;
                this._saveSynonyms(settings, synonyms);
                populateList();
            });
        });

        resetButton.connect('clicked', () => {
            const dialog = new Adw.AlertDialog({
                heading: _('Reset Synonyms'),
                body: _('This will replace all synonyms with the built-in defaults. This cannot be undone.'),
            });
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('reset', _('Reset'));
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_default_response('cancel');

            dialog.connect('response', (dlg, response) => {
                if (response === 'reset') {
                    settings.set_string('search-synonyms', '');
                    synonyms = JSON.parse(JSON.stringify(DEFAULT_SEARCH_SYNONYMS));
                    populateList();
                }
            });

            dialog.present(win);
        });

        win.present();
    }

    _openSynonymEditDialog(parent, keyword, apps, onSave) {
        const dialog = new Adw.AlertDialog({
            heading: keyword ? _('Edit Synonym') : _('Add Synonym'),
        });

        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('save', _('Save'));
        dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_default_response('save');

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
        });

        // Keyword entry
        const keywordEntry = new Adw.EntryRow({
            title: _('Keyword'),
            text: keyword,
        });
        const keywordListBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        keywordListBox.append(keywordEntry);
        box.append(keywordListBox);

        // Apps label
        const appsLabel = new Gtk.Label({
            label: _('App names (one per line)'),
            xalign: 0,
            css_classes: ['caption'],
            margin_top: 4,
        });
        box.append(appsLabel);

        // Apps text view
        const textFrame = new Gtk.Frame();
        const textScroll = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            min_content_height: 150,
        });
        const textView = new Gtk.TextView({
            wrap_mode: Gtk.WrapMode.WORD,
            top_margin: 8,
            bottom_margin: 8,
            left_margin: 8,
            right_margin: 8,
        });
        textView.buffer.set_text(apps.join('\n'), -1);
        textScroll.set_child(textView);
        textFrame.set_child(textScroll);
        box.append(textFrame);

        dialog.set_extra_child(box);

        dialog.connect('response', (dlg, response) => {
            if (response === 'save') {
                const newKeyword = keywordEntry.text.trim().toLowerCase();
                if (!newKeyword) return;

                const [start, end] = textView.buffer.get_bounds();
                const text = textView.buffer.get_text(start, end, false);
                const newApps = text.split('\n')
                    .map(s => s.trim().toLowerCase())
                    .filter(s => s.length > 0);

                if (newApps.length > 0) {
                    onSave(newKeyword, newApps);
                }
            }
        });

        dialog.present(parent);
    }

    _createSpacingPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Spacing'),
            icon_name: 'view-fullscreen-symbolic',
        });
        window.add(page);

        // Panel Padding Group
        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel Padding'),
            description: _('Overall panel spacing'),
        });
        page.add(panelGroup);

        // Panel Horizontal Padding
        const panelHPaddingRow = new Adw.SpinRow({
            title: _('Horizontal Padding'),
            subtitle: _('Left and right padding inside panel (0-32)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 32,
                step_increment: 2,
                value: settings.get_int('panel-padding-horizontal'),
            }),
        });
        panelHPaddingRow.connect('notify::value', (row) => {
            settings.set_int('panel-padding-horizontal', row.value);
        });
        panelGroup.add(panelHPaddingRow);

        // Panel Vertical Padding
        const panelVPaddingRow = new Adw.SpinRow({
            title: _('Vertical Padding'),
            subtitle: _('Top and bottom padding inside panel (0-16)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 16,
                step_increment: 1,
                value: settings.get_int('panel-padding-vertical'),
            }),
        });
        panelVPaddingRow.connect('notify::value', (row) => {
            settings.set_int('panel-padding-vertical', row.value);
        });
        panelGroup.add(panelVPaddingRow);

        // Left Section Spacing Group
        const leftSpacingGroup = new Adw.PreferencesGroup({
            title: _('Left Section Spacing'),
            description: _('Spacing for left-side elements'),
        });
        page.add(leftSpacingGroup);

        // Widgets Button Spacing
        const widgetsSpacingRow = new Adw.ActionRow({
            title: _('Widgets Button'),
            subtitle: _('Spacing handled by panel padding'),
        });
        widgetsSpacingRow.set_sensitive(false);
        leftSpacingGroup.add(widgetsSpacingRow);

        // Center Section Spacing Group
        const centerSpacingGroup = new Adw.PreferencesGroup({
            title: _('Center Section Spacing'),
            description: _('Spacing for taskbar elements'),
        });
        page.add(centerSpacingGroup);

        // Start Button Spacing
        const startSpacingRow = new Adw.SpinRow({
            title: _('Start Button'),
            subtitle: _('Margin around start button (0-32)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 32,
                step_increment: 2,
                value: settings.get_int('start-button-spacing'),
            }),
        });
        startSpacingRow.connect('notify::value', (row) => {
            settings.set_int('start-button-spacing', row.value);
        });
        centerSpacingGroup.add(startSpacingRow);

        // Search Spacing
        const searchSpacingRow = new Adw.SpinRow({
            title: _('Search Box'),
            subtitle: _('Margin around search box (0-32)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 32,
                step_increment: 2,
                value: settings.get_int('search-spacing'),
            }),
        });
        searchSpacingRow.connect('notify::value', (row) => {
            settings.set_int('search-spacing', row.value);
        });
        centerSpacingGroup.add(searchSpacingRow);

        // Task View Spacing
        const taskviewSpacingRow = new Adw.SpinRow({
            title: _('Task View Button'),
            subtitle: _('Margin around task view button (0-32)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 32,
                step_increment: 2,
                value: settings.get_int('taskview-spacing'),
            }),
        });
        taskviewSpacingRow.connect('notify::value', (row) => {
            settings.set_int('taskview-spacing', row.value);
        });
        centerSpacingGroup.add(taskviewSpacingRow);

        // App Icon Spacing
        const appSpacingRow = new Adw.SpinRow({
            title: _('App Icons'),
            subtitle: _('Spacing between app icons (0-16)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 16,
                step_increment: 1,
                value: settings.get_int('app-icon-spacing'),
            }),
        });
        appSpacingRow.connect('notify::value', (row) => {
            settings.set_int('app-icon-spacing', row.value);
        });
        centerSpacingGroup.add(appSpacingRow);

        // Right Section Spacing Group
        const rightSpacingGroup = new Adw.PreferencesGroup({
            title: _('Right Section Spacing'),
            description: _('Spacing for system tray and clock'),
        });
        page.add(rightSpacingGroup);

        // System Tray Spacing
        const traySpacingRow = new Adw.SpinRow({
            title: _('System Tray'),
            subtitle: _('Spacing between tray icons (0-32)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 32,
                step_increment: 2,
                value: settings.get_int('system-tray-spacing'),
            }),
        });
        traySpacingRow.connect('notify::value', (row) => {
            settings.set_int('system-tray-spacing', row.value);
        });
        rightSpacingGroup.add(traySpacingRow);

        // Clock Spacing
        const clockSpacingRow = new Adw.SpinRow({
            title: _('Clock'),
            subtitle: _('Margin around clock (0-32)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 32,
                step_increment: 2,
                value: settings.get_int('clock-spacing'),
            }),
        });
        clockSpacingRow.connect('notify::value', (row) => {
            settings.set_int('clock-spacing', row.value);
        });
        rightSpacingGroup.add(clockSpacingRow);
    }

    _createAdvancedPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Advanced'),
            icon_name: 'emblem-system-symbolic',
        });
        window.add(page);

        // ArcMenu Integration Group
        const arcmenuGroup = new Adw.PreferencesGroup({
            title: _('ArcMenu Integration'),
            description: _('Settings for ArcMenu compatibility'),
        });
        page.add(arcmenuGroup);

        // Use ArcMenu
        const arcmenuRow = new Adw.SwitchRow({
            title: _('Use ArcMenu'),
            subtitle: _('Use ArcMenu for start button if installed'),
        });
        settings.bind('use-arcmenu', arcmenuRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        arcmenuGroup.add(arcmenuRow);
/*
        // Start Button Customization Group
        const startButtonGroup = new Adw.PreferencesGroup({
            title: _('Start Button'),
            description: _('Customize the start button icon'),
        });
        page.add(startButtonGroup);

        // Start Button Style
        const startStyleRow = new Adw.ComboRow({
            title: _('Start Button Style'),
            subtitle: _('Icon style for the start button'),
        });
        startStyleRow.set_model(new Gtk.StringList({
            strings: [_('Default'), _('GNOME'), _('Custom')]
        }));
        startStyleRow.set_selected(settings.get_enum('start-button-style'));
        startStyleRow.connect('notify::selected', (row) => {
            settings.set_enum('start-button-style', row.selected);
        });
        startButtonGroup.add(startStyleRow);

        // Custom Start Icon
        const customIconRow = new Adw.ActionRow({
            title: _('Custom Icon Path'),
            subtitle: settings.get_string('custom-start-icon') || _('No icon selected'),
        });

        const chooseButton = new Gtk.Button({
            label: _('Choose File'),
            valign: Gtk.Align.CENTER,
        });

        chooseButton.connect('clicked', () => {
            const fileDialog = new Gtk.FileDialog({
                title: _('Select Icon File'),
            });

            // Set up file filter for images
            const imageFilter = new Gtk.FileFilter();
            imageFilter.set_name(_('Image Files'));
            imageFilter.add_mime_type('image/png');
            imageFilter.add_mime_type('image/svg+xml');
            imageFilter.add_mime_type('image/jpeg');
            imageFilter.add_mime_type('image/gif');
            imageFilter.add_pattern('*.png');
            imageFilter.add_pattern('*.svg');
            imageFilter.add_pattern('*.jpg');
            imageFilter.add_pattern('*.jpeg');
            imageFilter.add_pattern('*.gif');

            const filterList = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filterList.append(imageFilter);
            fileDialog.set_filters(filterList);
            fileDialog.set_default_filter(imageFilter);

            // Open the file chooser
            fileDialog.open(customIconRow.get_root(), null, (dialog, result) => {
                try {
                    const file = dialog.open_finish(result);
                    if (file) {
                        const path = file.get_path();
                        settings.set_string('custom-start-icon', path);
                        customIconRow.set_subtitle(path);
                    }
                } catch (e) {
                    if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) {
                        log(`[Winbar] Error selecting file: ${e.message}`);
                    }
                }
            });
        });

        customIconRow.add_suffix(chooseButton);
        customIconRow.set_activatable_widget(chooseButton);
        startButtonGroup.add(customIconRow);

        // Update subtitle when setting changes
        settings.connect('changed::custom-start-icon', () => {
            const path = settings.get_string('custom-start-icon');
            customIconRow.set_subtitle(path || _('No icon selected'));
        });
*/
        // Multi-Monitor Group
        const monitorGroup = new Adw.PreferencesGroup({
            title: _('Multi-Monitor'),
            description: _('Settings for multiple displays'),
        });
        page.add(monitorGroup);

        // Multi-Monitor Mode
        const monitorModeRow = new Adw.ComboRow({
            title: _('Multi-Monitor Mode'),
            subtitle: _('How to handle multiple monitors'),
        });
        monitorModeRow.set_model(new Gtk.StringList({ 
            strings: [_('Primary Only'), _('All Monitors'), _('All (Same Content)')] 
        }));
        monitorModeRow.set_selected(settings.get_enum('multi-monitor-mode'));
        monitorModeRow.connect('notify::selected', (row) => {
            settings.set_enum('multi-monitor-mode', row.selected);
        });
        monitorGroup.add(monitorModeRow);

        // Isolate Workspaces
        const isolateWsRow = new Adw.SwitchRow({
            title: _('Isolate Workspaces'),
            subtitle: _('Only show apps from current workspace'),
        });
        settings.bind('isolate-workspaces', isolateWsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        monitorGroup.add(isolateWsRow);

        // Isolate Monitors
        const isolateMonRow = new Adw.SwitchRow({
            title: _('Isolate Monitors'),
            subtitle: _('Only show apps from current monitor'),
        });
        settings.bind('isolate-monitors', isolateMonRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        monitorGroup.add(isolateMonRow);

        // Animation Group
        const animGroup = new Adw.PreferencesGroup({
            title: _('Animations'),
            description: _('Animation effects settings'),
        });
        page.add(animGroup);

        // Enable Animations
        const animRow = new Adw.SwitchRow({
            title: _('Enable Animations'),
            subtitle: _('Enable transition effects'),
        });
        settings.bind('enable-animations', animRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        animGroup.add(animRow);

        // Animation Duration
        const animDurationRow = new Adw.SpinRow({
            title: _('Animation Duration'),
            subtitle: _('Duration in milliseconds (0-500)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 500,
                step_increment: 25,
                value: settings.get_int('animation-duration'),
            }),
        });
        animDurationRow.connect('notify::value', (row) => {
            settings.set_int('animation-duration', row.value);
        });
        animGroup.add(animDurationRow);

        // Task Switcher Group
        const taskSwitcherGroup = new Adw.PreferencesGroup({
            title: _('Task Switcher'),
            description: _('Windows 11-style Alt+Tab switcher'),
        });
        page.add(taskSwitcherGroup);

        // Enable Task Switcher
        const taskSwitcherRow = new Adw.SwitchRow({
            title: _('Enable Task Switcher'),
            subtitle: _('Use custom Alt+Tab switcher (requires restart)'),
        });
        settings.bind('enable-task-switcher', taskSwitcherRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        taskSwitcherGroup.add(taskSwitcherRow);
        
        // Current Monitor Only
        const currentMonitorOnlyRow = new Adw.SwitchRow({
            title: _('Current Monitor Only'),
            subtitle: _('Only show windows from the current monitor'),
        });
        settings.bind('task-switcher-current-monitor-only', currentMonitorOnlyRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        taskSwitcherGroup.add(currentMonitorOnlyRow);
        
        // Window Position Management Group
        const windowPosGroup = new Adw.PreferencesGroup({
            title: _('Window Position Management'),
            description: _('Save and restore window positions across sessions'),
        });
        page.add(windowPosGroup);
        
        // Restore Window Positions
        const restoreWindowPosRow = new Adw.SwitchRow({
            title: _('Restore Window Positions'),
            subtitle: _('Remember window positions, sizes, and monitor placement'),
        });
        settings.bind('restore-window-positions', restoreWindowPosRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        windowPosGroup.add(restoreWindowPosRow);

        // About Group
        const aboutGroup = new Adw.PreferencesGroup({
            title: _('About'),
        });
        page.add(aboutGroup);

        const aboutRow = new Adw.ActionRow({
            title: _('Winbar'),
            subtitle: _('Windows 11 style taskbar for GNOME'),
        });
        aboutRow.add_prefix(new Gtk.Image({
            icon_name: 'view-app-grid-symbolic',
            pixel_size: 32,
        }));
        aboutGroup.add(aboutRow);

        const versionRow = new Adw.ActionRow({
            title: _('Version'),
            subtitle: '1.0',
        });
        aboutGroup.add(versionRow);
    }
}
