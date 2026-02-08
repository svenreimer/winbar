
// UI Constants
export const TASKBAR_HEIGHT = 48;
export const ICON_SIZE = 32;
export const ICON_PADDING = 4;
export const ANIMATION_TIME = 200;
export const ANIMATION_FRAME_DELAY = 16; // ~60fps, delay for X11 compatibility

// Window Position Manager Constants
export const POSITION_SAVE_INTERVAL_SECONDS = 300; // 5 minutes
export const POSITION_SAVE_DEBOUNCE_MS = 2000;
export const POSITION_RESTORE_WINDOW_SECONDS = 20;
export const POSITION_RESTORE_DELAY_MS = 200;
export const POSITION_WAIT_MAX_ATTEMPTS = 10;
export const POSITION_DATA_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Window Preview Constants
export const PREVIEW_THUMBNAIL_WIDTH = 200;
export const PREVIEW_THUMBNAIL_HEIGHT = 120;
export const PREVIEW_CLOSE_DELAY_MS = 300;
export const PREVIEW_PEEK_DELAY_MS = 500;
export const PREVIEW_PEEK_DIM_OPACITY = 10;

// Panel / Taskbar Constants
export const ORPHAN_CHECK_DELAYS = [500, 1500, 3000];
export const OFF_SCREEN_POSITION = -10000;
export const TOOLTIP_DELAY_MS = 500;
export const WINDOW_CLEANUP_INTERVAL_SECONDS = 5;
export const WINDOW_REMOVAL_DELAY_MS = 100;
export const APP_ASSOCIATION_CHECK_INTERVAL_MS = 1000;
export const APP_ASSOCIATION_MAX_CHECKS = 10;
export const MENU_OFFSET_PX = 8;
export const MENU_SCREEN_PADDING_PX = 10;

// System Tray Constants
export const TRAY_REPOSITION_MAX_ATTEMPTS = 50;
export const TRAY_REPOSITION_INITIAL_DELAY_MS = 5;
export const TRAY_PERIODIC_CHECK_INTERVAL_SECONDS = 2;
export const TRAY_CLONE_VALIDATION_INTERVAL_SECONDS = 3;

// Search Constants
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_BATCH_SIZE = 50;
export const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB

// Default search synonyms - mapping search terms to app name keywords
export const DEFAULT_SEARCH_SYNONYMS = {
    'terminal': ['console', 'konsole', 'gnome-terminal', 'xterm', 'terminator', 'alacritty', 'kitty', 'tilix', 'guake', 'yakuake', 'hyper', 'wezterm', 'foot', 'st', 'urxvt', 'rxvt', 'xfce4-terminal', 'lxterminal', 'mate-terminal', 'terminology', 'cool-retro-term', 'black box', 'ptyxis'],
    'term': ['console', 'konsole', 'gnome-terminal', 'terminal', 'xterm', 'terminator', 'alacritty', 'kitty'],
    'konsole': ['console', 'terminal', 'konsole'],
    'shell': ['console', 'konsole', 'gnome-terminal', 'terminal', 'bash', 'zsh'],
    'command': ['console', 'konsole', 'gnome-terminal', 'terminal'],
    'cmd': ['console', 'konsole', 'gnome-terminal', 'terminal'],
    'cli': ['console', 'konsole', 'gnome-terminal', 'terminal'],
    'browser': ['firefox', 'chromium', 'chrome', 'google-chrome', 'brave', 'edge', 'vivaldi', 'opera', 'epiphany', 'web'],
    'internet': ['firefox', 'chromium', 'chrome', 'brave', 'edge'],
    'web': ['firefox', 'chromium', 'chrome', 'brave', 'edge', 'epiphany'],
    'ff': ['firefox'],
    'code': ['visual studio code', 'code', 'vscode', 'codium', 'vscodium', 'atom', 'sublime', 'gedit', 'kate', 'geany'],
    'editor': ['visual studio code', 'code', 'vscode', 'gedit', 'kate', 'vim', 'neovim', 'emacs', 'nano', 'sublime', 'atom', 'geany', 'notepad'],
    'ide': ['visual studio code', 'code', 'jetbrains', 'intellij', 'pycharm', 'webstorm', 'eclipse', 'netbeans', 'kdevelop', 'gnome-builder', 'android studio'],
    'vs': ['visual studio code', 'vscode'],
    'vsc': ['visual studio code', 'vscode'],
    'vis': ['visual studio code', 'vscode'],
    'files': ['nautilus', 'files', 'dolphin', 'thunar', 'nemo', 'pcmanfm', 'konqueror', 'caja', 'spacefm'],
    'file manager': ['nautilus', 'files', 'dolphin', 'thunar', 'nemo'],
    'explorer': ['nautilus', 'files', 'dolphin', 'thunar', 'nemo'],
    'folder': ['nautilus', 'files', 'dolphin', 'thunar'],
    'datei': ['nautilus', 'files', 'dolphin', 'thunar'],
    'text': ['gedit', 'kate', 'gnome-text-editor', 'mousepad', 'pluma', 'leafpad', 'notepad'],
    'office': ['libreoffice', 'openoffice', 'calligra', 'onlyoffice', 'wps'],
    'word': ['libreoffice writer', 'writer', 'abiword'],
    'excel': ['libreoffice calc', 'calc', 'gnumeric'],
    'powerpoint': ['libreoffice impress', 'impress'],
    'spreadsheet': ['libreoffice calc', 'calc', 'gnumeric'],
    'document': ['libreoffice writer', 'writer', 'abiword'],
    'music': ['spotify', 'rhythmbox', 'lollypop', 'elisa', 'clementine', 'amarok', 'audacious', 'deadbeef', 'vlc', 'mpv'],
    'video': ['vlc', 'mpv', 'totem', 'celluloid', 'smplayer', 'kaffeine', 'parole', 'dragon'],
    'player': ['vlc', 'mpv', 'totem', 'spotify', 'rhythmbox'],
    'movie': ['vlc', 'mpv', 'totem', 'celluloid'],
    'film': ['vlc', 'mpv', 'totem', 'celluloid'],
    'musik': ['spotify', 'rhythmbox', 'lollypop', 'elisa'],
    'image': ['eog', 'image viewer', 'gwenview', 'feh', 'sxiv', 'ristretto', 'gpicview', 'gimp', 'krita'],
    'photo': ['eog', 'image viewer', 'gwenview', 'shotwell', 'digikam', 'darktable', 'gimp'],
    'picture': ['eog', 'image viewer', 'gwenview', 'gimp'],
    'bild': ['eog', 'image viewer', 'gwenview', 'gimp'],
    'graphics': ['gimp', 'krita', 'inkscape', 'blender'],
    'paint': ['gimp', 'krita', 'kolourpaint', 'drawing'],
    'draw': ['inkscape', 'krita', 'gimp', 'drawing'],
    'chat': ['telegram', 'discord', 'signal', 'element', 'slack', 'teams', 'whatsapp'],
    'message': ['telegram', 'discord', 'signal', 'element', 'slack'],
    'mail': ['thunderbird', 'evolution', 'geary', 'mailspring', 'kmail'],
    'email': ['thunderbird', 'evolution', 'geary', 'mailspring', 'kmail'],
    'settings': ['gnome-control-center', 'settings', 'systemsettings', 'system settings'],
    'preferences': ['gnome-control-center', 'settings', 'preferences'],
    'config': ['gnome-control-center', 'settings', 'dconf', 'gconf'],
    'einstellungen': ['gnome-control-center', 'settings', 'systemsettings'],
    'system': ['gnome-system-monitor', 'system monitor', 'ksysguard', 'htop'],
    'monitor': ['gnome-system-monitor', 'system monitor', 'ksysguard'],
    'task': ['gnome-system-monitor', 'system monitor', 'ksysguard', 'htop'],
    'process': ['gnome-system-monitor', 'system monitor', 'ksysguard', 'htop'],
    'archive': ['file-roller', 'ark', 'engrampa', 'xarchiver', 'peazip'],
    'zip': ['file-roller', 'ark', 'engrampa', 'xarchiver'],
    'extract': ['file-roller', 'ark', 'engrampa'],
    'compress': ['file-roller', 'ark', 'engrampa'],
    'calc': ['gnome-calculator', 'calculator', 'kcalc', 'galculator', 'speedcrunch', 'libreoffice calc'],
    'calculator': ['gnome-calculator', 'calculator', 'kcalc', 'galculator'],
    'rechner': ['gnome-calculator', 'calculator', 'kcalc'],
    'screenshot': ['gnome-screenshot', 'flameshot', 'spectacle', 'shutter', 'scrot'],
    'bildschirmfoto': ['gnome-screenshot', 'flameshot', 'spectacle'],
    'notes': ['gnome-notes', 'tomboy', 'gnote', 'simplenote', 'joplin', 'obsidian', 'notion'],
    'notizen': ['gnome-notes', 'tomboy', 'gnote', 'simplenote'],
};

// Theme Colors
export const THEME_COLORS = {
    dark: {
        bg: 'rgba(32, 32, 32, 0.95)',
        border: 'rgba(255, 255, 255, 0.08)',
        text: 'rgba(255, 255, 255, 0.9)',
        textSecondary: 'rgba(255, 255, 255, 0.5)',
        iconColor: 'rgba(255, 255, 255, 0.9)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.05)',
        hoverBg: 'rgba(255, 255, 255, 0.1)',
        subtleBg: 'rgba(255, 255, 255, 0.05)',
    },
    light: {
        bg: 'rgba(243, 243, 243, 0.95)',
        border: 'rgba(0, 0, 0, 0.08)',
        text: 'rgba(0, 0, 0, 0.9)',
        textSecondary: 'rgba(0, 0, 0, 0.5)',
        iconColor: 'rgba(0, 0, 0, 0.9)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15), inset 0 0 0 1px rgba(0, 0, 0, 0.03)',
        hoverBg: 'rgba(0, 0, 0, 0.06)',
        subtleBg: 'rgba(0, 0, 0, 0.03)',
    },
};

// Standard freedesktop.org categories for apps
export const STANDARD_CATEGORIES = {
    'AudioVideo': { name: 'Multimedia', icon: 'applications-multimedia-symbolic' },
    'Audio': { name: 'Audio', icon: 'audio-x-generic-symbolic' },
    'Video': { name: 'Video', icon: 'video-x-generic-symbolic' },
    'Development': { name: 'Development', icon: 'applications-development-symbolic' },
    'Education': { name: 'Education', icon: 'applications-education-symbolic' },
    'Game': { name: 'Games', icon: 'applications-games-symbolic' },
    'Graphics': { name: 'Graphics', icon: 'applications-graphics-symbolic' },
    'Network': { name: 'Internet', icon: 'applications-internet-symbolic' },
    'Office': { name: 'Office', icon: 'applications-office-symbolic' },
    'Science': { name: 'Science', icon: 'applications-science-symbolic' },
    'Settings': { name: 'Settings', icon: 'preferences-system-symbolic' },
    'System': { name: 'System', icon: 'applications-system-symbolic' },
    'Utility': { name: 'Utilities', icon: 'applications-utilities-symbolic' },
};
