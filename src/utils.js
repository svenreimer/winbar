import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

// DBus interface for StatusNotifierWatcher (provided by AppIndicator extension)
export const StatusNotifierWatcherIface = `
<node>
    <interface name="org.kde.StatusNotifierWatcher">
        <method name="RegisterStatusNotifierItem">
            <arg type="s" direction="in" name="service"/>
        </method>
        <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
        <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
        <property name="ProtocolVersion" type="i" access="read"/>
        <signal name="StatusNotifierItemRegistered">
            <arg type="s" name="service"/>
        </signal>
        <signal name="StatusNotifierItemUnregistered">
            <arg type="s" name="service"/>
        </signal>
        <signal name="StatusNotifierHostRegistered"/>
        <signal name="StatusNotifierHostUnregistered"/>
    </interface>
</node>`;

// DBus interface for StatusNotifierItem
export const StatusNotifierItemIface = `
<node>
    <interface name="org.kde.StatusNotifierItem">
        <property name="Category" type="s" access="read"/>
        <property name="Id" type="s" access="read"/>
        <property name="Title" type="s" access="read"/>
        <property name="Status" type="s" access="read"/>
        <property name="WindowId" type="i" access="read"/>
        <property name="IconName" type="s" access="read"/>
        <property name="IconThemePath" type="s" access="read"/>
        <property name="IconPixmap" type="a(iiay)" access="read"/>
        <property name="OverlayIconName" type="s" access="read"/>
        <property name="OverlayIconPixmap" type="a(iiay)" access="read"/>
        <property name="AttentionIconName" type="s" access="read"/>
        <property name="AttentionIconPixmap" type="a(iiay)" access="read"/>
        <property name="AttentionMovieName" type="s" access="read"/>
        <property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
        <property name="ItemIsMenu" type="b" access="read"/>
        <property name="Menu" type="o" access="read"/>
        <method name="ContextMenu">
            <arg type="i" direction="in" name="x"/>
            <arg type="i" direction="in" name="y"/>
        </method>
        <method name="Activate">
            <arg type="i" direction="in" name="x"/>
            <arg type="i" direction="in" name="y"/>
        </method>
        <method name="SecondaryActivate">
            <arg type="i" direction="in" name="x"/>
            <arg type="i" direction="in" name="y"/>
        </method>
        <method name="Scroll">
            <arg type="i" direction="in" name="delta"/>
            <arg type="s" direction="in" name="orientation"/>
        </method>
        <signal name="NewTitle"/>
        <signal name="NewIcon"/>
        <signal name="NewAttentionIcon"/>
        <signal name="NewOverlayIcon"/>
        <signal name="NewToolTip"/>
        <signal name="NewStatus">
            <arg type="s" name="status"/>
        </signal>
    </interface>
</node>`;

// DBus interface for DBusMenu
export const DBusMenuIface = `
<node>
    <interface name="com.canonical.dbusmenu">
        <method name="GetLayout">
            <arg type="i" direction="in" name="parentId"/>
            <arg type="i" direction="in" name="recursionDepth"/>
            <arg type="as" direction="in" name="propertyNames"/>
            <arg type="u" direction="out" name="revision"/>
            <arg type="(ia{sv}av)" direction="out" name="layout"/>
        </method>
        <method name="Event">
            <arg type="i" direction="in" name="id"/>
            <arg type="s" direction="in" name="eventId"/>
            <arg type="v" direction="in" name="data"/>
            <arg type="u" direction="in" name="timestamp"/>
        </method>
        <method name="AboutToShow">
            <arg type="i" direction="in" name="id"/>
            <arg type="b" direction="out" name="needUpdate"/>
        </method>
        <signal name="ItemsPropertiesUpdated">
            <arg type="a(ia{sv})" name="updatedProps"/>
            <arg type="a(ias)" name="removedProps"/>
        </signal>
        <signal name="LayoutUpdated">
            <arg type="u" name="revision"/>
            <arg type="i" name="parent"/>
        </signal>
    </interface>
</node>`;

// Create DBus proxy wrappers
export const StatusNotifierWatcherProxy = Gio.DBusProxy.makeProxyWrapper(StatusNotifierWatcherIface);
export const StatusNotifierItemProxy = Gio.DBusProxy.makeProxyWrapper(StatusNotifierItemIface);
export const DBusMenuProxy = Gio.DBusProxy.makeProxyWrapper(DBusMenuIface);

// Helper function to get effective theme mode (respects system preference for auto mode)
export function getEffectiveThemeMode(settings) {
    const themeMode = settings.get_enum('theme-mode');

    // If not auto, return as-is
    if (themeMode !== 0) {
        return themeMode;
    }

    // Auto mode - detect system preference
    try {
        const interfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
        const colorScheme = interfaceSettings.get_string('color-scheme');

        // color-scheme can be: 'default', 'prefer-dark', or 'prefer-light'
        // In modern GNOME, 'default' means light mode (or no preference, which defaults to light)
        // Only use dark mode when explicitly set to 'prefer-dark'
        if (colorScheme === 'prefer-dark') {
            return 1; // dark
        } else {
            return 2; // light (for 'prefer-light' or 'default')
        }
    } catch (e) {
        log(`[Winbar] Could not detect system theme: ${e.message}`);
        return 2; // fallback to light (modern GNOME default)
    }
}

/**
 * Add blur effect to an actor for frosted glass appearance
 * Works on both X11 and Wayland with appropriate fallback
 */
export function addBlurEffect(actor, brightness = 0.6) {
    try {
        // Remove any existing blur effect first
        actor.remove_effect_by_name('blur');

        const blurEffect = new Shell.BlurEffect({
            brightness: brightness,
            mode: Shell.BlurMode.BACKGROUND,
        });
        actor.add_effect_with_name('blur', blurEffect);
        return true;
    } catch (e) {
        log(`[Winbar] Could not add blur effect: ${e.message}`);
        return false;
    }
}
