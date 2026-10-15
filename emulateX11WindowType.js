/* LICENSE INFORMATION
 *
 * Desktop Icons: Neo - A desktop icons extension for GNOME with numerous features,
 * customizations, and optimizations.
 *
 * Copyright 2021 Abdurahman Elmawi (cooper64doom@gmail.com)
 *
 * This project is based on Desktop Icons NG (https://gitlab.com/rastersoft/desktop-icons-ng),
 * a desktop icons extension for GNOME licensed under the GPL v3.
 *
 * This project is free and open source software as described in the GPL v3.
 *
 * This project (Desktop Icons: Neo) is licensed under the GPL v3. To view the details of this license,
 * visit https://www.gnu.org/licenses/gpl-3.0.html for the necessary information
 * regarding this project's license.
 *
 * Ported to GNOME 45/46/47/48/49/50 (ESM).
 */

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function _isWayland() {
    return Meta.is_wayland_compositor === undefined ||
        Meta.is_wayland_compositor();
}

function _hideFromWindowList(window, waylandClient) {
    // GNOME 49+: Meta.Window.hide_from_window_list() replaces
    // Meta.WaylandClient.hide_from_window_list()
    if (window.hide_from_window_list) {
        try {
            window.hide_from_window_list();
            return;
        } catch (e) {
            // fall through to legacy API
        }
    }
    if (waylandClient) {
        try {
            waylandClient.hide_from_window_list(window);
        } catch (e) {
            // ignore (client may have been destroyed)
        }
    }
}

function _showInWindowList(window, waylandClient) {
    // GNOME 49+: Meta.Window.show_in_window_list() replaces
    // Meta.WaylandClient.show_in_window_list()
    if (window.show_in_window_list) {
        try {
            window.show_in_window_list();
            return;
        } catch (e) {
            // fall through to legacy API
        }
    }
    if (waylandClient) {
        try {
            waylandClient.show_in_window_list(window);
        } catch (e) {
            // ignore
        }
    }
}

class ManageWindow {
    /* This class is added to each managed window, and it's used to
       make it behave like an X11 Desktop window.

       Trusted windows will set in the title the characters @!, followed
       by the coordinates where to put the window separated by a colon, and
       ended in semicolon. After that, it can have one or more of these letters

       * B : put this window at the bottom of the screen
       * T : put this window at the top of the screen
       * D : show this window in all desktops
       * H : hide this window from window list

       Using the title is not a problem because this is only useful for windows
       without decorations.
    */

    constructor(window, waylandClient) {
        this._waylandClient = waylandClient;
        this._window = window;
        this._signalIDs = [];
        this._moveIntoPlaceID = 0;
        this._signalIDs.push(window.connect_after('raised', () => {
            if (this._keepAtBottom && !this._keepAtTop) {
                this._window.lower();
            }
        }));
        this._signalIDs.push(window.connect('position-changed', () => {
            if (this._fixed && (this._x !== null) && (this._y !== null)) {
                this._window.move_frame(false, this._x, this._y);
            }
        }));
        this._signalIDs.push(window.connect('notify::title', () => {
            this._parseTitle();
        }));
        // Keep desktop below everything and unminimized (backport from DING,
        // needed on recent GNOME where overview/window-management changed)
        this._signalIDs.push(window.connect('notify::above', () => {
            if (this._keepAtBottom && this._window.above) {
                try {
                    this._window.unmake_above();
                } catch (e) {
                    // ignore
                }
            }
        }));
        this._signalIDs.push(window.connect('notify::minimized', () => {
            if (this._keepAtBottom && this._window.minimized) {
                try {
                    this._window.unminimize();
                } catch (e) {
                    // ignore
                }
            }
        }));
        this._parseTitle();
    }

    disconnect() {
        for (const signalID of this._signalIDs) {
            try {
                this._window.disconnect(signalID);
            } catch (e) {
                // ignore
            }
        }
        this._signalIDs = [];
        if (this._moveIntoPlaceID) {
            GLib.source_remove(this._moveIntoPlaceID);
            this._moveIntoPlaceID = 0;
        }
        if (this._keepAtTop && !this._windowUnmanaged) {
            try {
                this._window.unmake_above();
            } catch (e) {
                // ignore
            }
        }
        this._window = null;
        this._waylandClient = null;
    }

    set_wayland_client(client) {
        this._waylandClient = client;
    }

    _parseTitle() {
        this._x = null;
        this._y = null;
        this._keepAtBottom = false;
        const keepAtTop = this._keepAtTop;
        this._keepAtTop = false;
        this._showInAllDesktops = false;
        this._hideFromWindowList = false;
        this._fixed = false;
        const title = this._window.get_title();
        if (title != null) {
            const pos = title.search('@!');
            if (pos !== -1) {
                const pos2 = title.indexOf(';', pos);
                let coords;
                if (pos2 !== -1) {
                    coords = title.substring(pos + 2, pos2).trim().split(',');
                } else {
                    coords = title.substring(pos + 2).trim().split(',');
                }
                try {
                    this._x = parseInt(coords[0], 10);
                    this._y = parseInt(coords[1], 10);
                    if (Number.isNaN(this._x))
                        this._x = null;
                    if (Number.isNaN(this._y))
                        this._y = null;
                } catch (e) {
                    console.warn(`Desktop Icons: Neo: exception parsing title: ${e.message}`);
                }
                try {
                    const extraChars = title.substring(pos + 2).trim().toUpperCase();
                    for (const char of extraChars) {
                        switch (char) {
                        case 'B':
                            this._keepAtBottom = true;
                            this._keepAtTop = false;
                            break;
                        case 'T':
                            this._keepAtTop = true;
                            this._keepAtBottom = false;
                            break;
                        case 'D':
                            this._showInAllDesktops = true;
                            break;
                        case 'H':
                            this._hideFromWindowList = true;
                            break;
                        case 'F':
                            this._fixed = true;
                            break;
                        default:
                            break;
                        }
                    }
                } catch (e) {
                    console.warn(`Desktop Icons: Neo: exception parsing title flags: ${e.message}`);
                }
            }
            if (this._waylandClient) {
                if (this._hideFromWindowList) {
                    _hideFromWindowList(this._window, this._waylandClient);
                } else {
                    _showInWindowList(this._window, this._waylandClient);
                }
            }
            if (this._keepAtTop !== keepAtTop) {
                try {
                    if (this._keepAtTop) {
                        this._window.make_above();
                    } else {
                        this._window.unmake_above();
                    }
                } catch (e) {
                    // ignore
                }
            }
            if (this._keepAtBottom) {
                this._window.lower();
            }
            if (this._fixed && (this._x !== null) && (this._y !== null)) {
                try {
                    this._window.move_frame(false, this._x, this._y);
                } catch (e) {
                    // ignore
                }
            }
        }
    }

    refreshState(checkWorkspace) {
        if (this._keepAtBottom) {
            try {
                this._window.lower();
            } catch (e) {
                // ignore
            }
        }
        if (checkWorkspace && this._showInAllDesktops) {
            try {
                const currentWorkspace = global.workspace_manager.get_active_workspace();
                if (currentWorkspace && !this._window.located_on_workspace(currentWorkspace)) {
                    this._window.change_workspace(currentWorkspace);
                }
            } catch (e) {
                // ignore
            }
        }
    }

    get hideFromWindowList() {
        return this._hideFromWindowList;
    }

    get keepAtBottom() {
        return this._keepAtBottom;
    }
}

export class EmulateX11WindowType {
    /*
     This class makes all the heavy lifting for emulating WindowType.
     Just make one instance of it, call enable(), and whenever a window
     that you want to give "superpowers" is mapped, add it with the
     "addWindow" method. That's all.
     */
    constructor() {
        this._isX11 = !_isWayland();
        this._windowList = [];
        this._enableRefresh = true;
        this._waylandClient = null;
        this._activate_window_ID = 0;
        this._idMap = 0;
        this._idDestroy = 0;
        this._switchWorkspaceId = 0;
        this._showingId = 0;
        this._hidingId = 0;
    }

    set_wayland_client(client) {
        this._waylandClient = client;
        for (const window of this._windowList) {
            if (window.customJS_desktopiconsneo) {
                window.customJS_desktopiconsneo.set_wayland_client(this._waylandClient);
            }
        }
    }

    enable() {
        if (this._isX11) {
            return;
        }
        this._replaceGetWindowActors();
        this._idMap = global.window_manager.connect_after('map', (obj, windowActor) => {
            const window = windowActor.get_meta_window();
            if (this._waylandClient && this._waylandClient.query_window_belongs_to(window)) {
                this.addWindow(window);
            }
            this._refreshWindows(false);
        });
        this._idDestroy = global.window_manager.connect_after('destroy', (wm, windowActor) => {
            // if a window is closed, ensure that the desktop doesn't receive the focus
            const window = windowActor.get_meta_window();
            if (window && (window.get_window_type() >= Meta.WindowType.DROPDOWN_MENU)) {
                return;
            }
            this._refreshWindows(true);
        });
        /* Something odd happens with "stick" when using popup submenus, so
           this implements the same functionality
         */
        this._switchWorkspaceId = global.window_manager.connect('switch-workspace', () => {
            this._refreshWindows(true);
        });

        /* But in Overview mode it is paramount to not change the workspace to emulate
           "stick", or the windows will appear
         */
        this._showingId = Main.overview.connect('showing', () => {
            this._enableRefresh = false;
        });

        this._hidingId = Main.overview.connect('hiding', () => {
            this._enableRefresh = true;
            this._refreshWindows(true);
        });
    }

    disable() {
        if (this._isX11) {
            // still clear state in case enable() is called again under Wayland
            // (e.g. nested session changes); nothing connected, so just reset
            this._windowList = [];
            return;
        }
        if (this._activate_window_ID) {
            GLib.source_remove(this._activate_window_ID);
            this._activate_window_ID = 0;
        }
        for (const window of this._windowList) {
            this._clearWindow(window);
        }
        this._windowList = [];

        // restore external methods only if have been intercepted
        this._restoreGetWindowActors();

        // disconnect signals
        if (this._idMap) {
            global.window_manager.disconnect(this._idMap);
            this._idMap = 0;
        }
        if (this._idDestroy) {
            global.window_manager.disconnect(this._idDestroy);
            this._idDestroy = 0;
        }
        if (this._switchWorkspaceId) {
            global.window_manager.disconnect(this._switchWorkspaceId);
            this._switchWorkspaceId = 0;
        }
        if (this._showingId) {
            Main.overview.disconnect(this._showingId);
            this._showingId = 0;
        }
        if (this._hidingId) {
            Main.overview.disconnect(this._hidingId);
            this._hidingId = 0;
        }
    }

    addWindow(window) {
        if (this._isX11) {
            return;
        }
        if (window.get_meta_window) { // it is a MetaWindowActor
            window = window.get_meta_window();
        }
        if (window.customJS_desktopiconsneo) {
            // already managed
            return;
        }
        window.customJS_desktopiconsneo = new ManageWindow(window, this._waylandClient);
        this._windowList.push(window);
        window.customJS_desktopiconsneo.unmanagedID = window.connect('unmanaged', win => {
            if (win.customJS_desktopiconsneo)
                win.customJS_desktopiconsneo._windowUnmanaged = true;
            this._clearWindow(win);
            this._windowList = this._windowList.filter(item => item !== win);
        });
    }

    _clearWindow(window) {
        if (!window.customJS_desktopiconsneo)
            return;
        try {
            window.disconnect(window.customJS_desktopiconsneo.unmanagedID);
        } catch (e) {
            // ignore
        }
        try {
            window.customJS_desktopiconsneo.disconnect();
        } catch (e) {
            // ignore
        }
        window.customJS_desktopiconsneo = null;
    }

    _refreshWindows(checkWorkspace) {
        if (!this._activate_window_ID) {
            this._activate_window_ID = GLib.idle_add(GLib.PRIORITY_LOW, () => {
                if (this._enableRefresh) {
                    for (const window of this._windowList) {
                        try {
                            window.customJS_desktopiconsneo.refreshState(checkWorkspace);
                        } catch (e) {
                            // ignore
                        }
                    }
                    if (checkWorkspace) {
                        // activate the top-most window
                        try {
                            const windows = global.display.get_tab_list(
                                Meta.TabList.NORMAL_ALL,
                                global.workspace_manager.get_active_workspace());
                            for (const window of windows) {
                                if ((!window.customJS_desktopiconsneo ||
                                     !window.customJS_desktopiconsneo.keepAtBottom) &&
                                    !window.minimized) {
                                    Main.activateWindow(window);
                                    break;
                                }
                            }
                        } catch (e) {
                            // ignore
                        }
                    }
                }
                this._activate_window_ID = 0;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _replaceGetWindowActors() {
        if (replaceData.old_get_window_actors)
            return;
        replaceData.old_get_window_actors = Shell.Global.prototype.get_window_actors;
        Shell.Global.prototype.get_window_actors = function () {
            const windowList = replaceData.old_get_window_actors.apply(this, []);
            return _removeDesktopWindowFromList(windowList);
        };
    }

    _restoreGetWindowActors() {
        if (replaceData.old_get_window_actors) {
            Shell.Global.prototype.get_window_actors = replaceData.old_get_window_actors;
        }
        replaceData = {};
    }
}

/**
 * Functions used to remove a window from the window list
 */

let replaceData = {};

/**
 * Receives a list of metaWindow or metaWindowActor objects, and remove from it
 * our desktop window
 *
 * @param {GList} windowList A list of metaWindow or metaWindowActor objects
 * @returns {GList} The same list, but with the desktop window removed
 */
function _removeDesktopWindowFromList(windowList) {
    const returnVal = [];
    for (const element of windowList) {
        let window = element;
        if (window.get_meta_window) { // it is a MetaWindowActor
            window = window.get_meta_window();
        }
        if (!window.customJS_desktopiconsneo || !window.customJS_desktopiconsneo.hideFromWindowList) {
            returnVal.push(element);
        }
    }
    return returnVal;
}
