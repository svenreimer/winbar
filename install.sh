#!/bin/bash

# Winbar GNOME Extension Install Script
# This script installs the Winbar extension to your local GNOME extensions directory

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Extension UUID from metadata.json
EXTENSION_UUID="winbar@gnome-extension"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Installation directory
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

echo -e "${GREEN}Installing Winbar GNOME Extension...${NC}"

# Create installation directory if it doesn't exist
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Extension directory already exists. Removing old installation...${NC}"
    rm -rf "$INSTALL_DIR"
fi

echo "Creating extension directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Copy extension files
echo "Copying extension files..."
cp "$SCRIPT_DIR/extension.js" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/metadata.json" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/prefs.js" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/stylesheet.css" "$INSTALL_DIR/"

# Copy src directory
if [ -d "$SCRIPT_DIR/src" ]; then
    echo "Copying src directory..."
    cp -r "$SCRIPT_DIR/src" "$INSTALL_DIR/"
fi

# Copy schemas directory and compile schemas
if [ -d "$SCRIPT_DIR/schemas" ]; then
    echo "Copying schemas directory..."
    mkdir -p "$INSTALL_DIR/schemas"
    cp "$SCRIPT_DIR/schemas/"*.xml "$INSTALL_DIR/schemas/"
    
    # Compile schemas
    echo "Compiling GSettings schemas..."
    if command -v glib-compile-schemas &> /dev/null; then
        glib-compile-schemas "$INSTALL_DIR/schemas/"
        echo -e "${GREEN}Schemas compiled successfully${NC}"
    else
        echo -e "${RED}Warning: glib-compile-schemas not found. Schemas not compiled.${NC}"
        echo -e "${YELLOW}Please install glib2-devel or libglib2.0-dev package.${NC}"
    fi
fi

# Copy additional files if they exist
if [ -f "$SCRIPT_DIR/README.md" ]; then
    cp "$SCRIPT_DIR/README.md" "$INSTALL_DIR/"
fi

echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Extension installed to: $INSTALL_DIR"
echo ""
echo "To enable the extension, run one of the following:"
echo "  1. Use GNOME Extensions app"
echo "  2. Run: gnome-extensions enable $EXTENSION_UUID"
echo ""
echo -e "${YELLOW}Note: You may need to restart GNOME Shell for the extension to appear:${NC}"
echo "  - On X11: Press Alt+F2, type 'r', and press Enter"
echo "  - On Wayland: Log out and log back in"
echo ""
