# Winbar

**A modern, Windows like taskbar for GNOME Shell.**

> **Note:** This project is in early development. Features may be incomplete, unstable, or subject to change.

Winbar transforms your GNOME desktop with a functional, customizable taskbar featuring a centered layout, a powerful Start Menu, and a unified System Tray.

## Features

- **Start Menu**: A robust custom Start Menu with pinned apps, recommended files, app browsing and search.
    - *ArcMenu Support*: Integrates with [ArcMenu](https://extensions.gnome.org/extension/3628/arcmenu/) if installed.
- **Taskbar**:
    - Centered aligned app icons.
    - Window previews on hover.
    - Smart window management (minimize, cycle, preview).
    - Pin/Unpin apps directly from the taskbar / start menu.
    - Drag and drop to reorder pinned apps.
- **System Tray**:
    - Unified Quick Settings panel (Wi-Fi, Bluetooth, Volume, Brightness, Night Light, Dark Mode).
    - Support for AppIndicators (StatusNotifierItems).
    - Clock with calendar integration.
    - Notification center toggle.
- **Widgets**: Dedicated panel for (gnome) weather.
- **Customization**:
    - Adjustable height, icon size, and position (Top/Bottom).
    - Light/Dark mode support (auto-detects system preference).
    - Blur effects (frosted glass).
    - Multi-monitor support.

## Requirements

- GNOME Shell 45 or later (Tested on 48+)
- `libgweather` (for Weather widget)

## Installation

### Automatic Installation

1.  Clone this repository:
    ```bash
    git clone https://github.com/svenreimer/winbar.git
    ```

2.  Run the install script:
    ```bash
    ./install.sh
    ```

3.  **Restart GNOME Shell**:
    - **Wayland**: Log out and log back in.
    - **X11**: Press `Alt` + `F2`, type `r`, and hit `Enter`.

4.  Enable the extension using **Extensions** app or terminal:
    ```bash
    gnome-extensions enable winbar@gnome-extension
    ```

### Manual Installation

1.  Clone this repository:
    ```bash
    git clone https://github.com/svenreimer/winbar.git
    ```

2.  Copy the extension to your local extensions directory:
    ```bash
    cp -r winbar ~/.local/share/gnome-shell/extensions/winbar@gnome-extension
    ```

3.  Install schemas:
    ```bash
    cd ~/.local/share/gnome-shell/extensions/winbar@gnome-extension && glib-compile-schemas schemas/
    ```

4.  **Restart GNOME Shell**:
    - **Wayland**: Log out and log back in.
    - **X11**: Press `Alt` + `F2`, type `r`, and hit `Enter`.

5.  Enable the extension using **Extensions** app or terminal:
    ```bash
    gnome-extensions enable winbar@gnome-extension
    ```

## Development

This extension is built with ES modules.

- `src/`: Source code modules
    - `ui/`: UI components (Panel, StartMenu, etc.)
    - `utils.js`: Shared utilities and DBus interfaces
- `schemas/`: GSettings schemas
- `stylesheet.css`: Styling

## License

Distributed under the GPL-3.0 License. See `LICENSE` for more information.
