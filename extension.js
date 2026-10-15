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
 * Ported to GNOME 45/46/47/48/49/50 (ESM, WaylandClient new API, ExtensionPreferences).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as EmulateX11 from './emulateX11WindowType.js';

function _isWayland() {
    return Meta.is_wayland_compositor === undefined ||
        Meta.is_wayland_compositor();
}

export default class DesktopIconsNeo extends Extension {
    constructor(metadata) {
        super(metadata);
        this._data = {};
        this._data.isEnabled = false;
        this._data.launchDesktopId = 0;
        this._data.currentProcess = null;
        this._data.reloadTime = 100;

        /* The constructor of the EmulateX11 class only initializes some
         * internal properties, but nothing else. In fact, it has its own
         * enable() and disable() methods.
         */
        this._data.x11Manager = null;

        /* Ensures that there aren't "rogue" processes.
         * This is a safeguard measure for the case of Gnome Shell being
         * relaunched, to kill any old DI:NEO instance.
         */
        this._doKillAllOldDesktopProcesses();
    }

    enable() {
        if (!this._data.x11Manager) {
            this._data.x11Manager = new EmulateX11.EmulateX11WindowType();
        }
        // If the desktop is still starting up, we wait until it is ready
        if (Main.layoutManager._startingUp) {
            this._data.startupPreparedId = Main.layoutManager.connect(
                'startup-complete', () => this._innerEnable(true));
        } else {
            this._data.startupPreparedId = 0;
            this._innerEnable(false);
        }
    }

    /**
     * The true code that configures everything and launches the desktop program
     */
    _innerEnable(removeId) {
        if (removeId) {
            if (this._data.startupPreparedId) {
                Main.layoutManager.disconnect(this._data.startupPreparedId);
                this._data.startupPreparedId = 0;
            }
        }

        // under X11 we don't need to cheat, so only do all this under wayland
        // (on GNOME 50 X11 support was removed, so this is always true there)
        if (_isWayland()) {
            this._data.x11Manager.enable();
        }

        /*
         * If the desktop geometry changes (because a new monitor has been added, for example),
         * we kill the desktop program. It will be relaunched automatically with the new geometry,
         * thus adapting to it on-the-fly.
         */
        this._data.monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._reloadIfSizesChanged());
        /*
         * Any change in the workareas must be detected too, for example if the used size
         * changes.
         */
        this._data.workareasChangedId = global.display.connect(
            'workareas-changed', () => this._reloadIfSizesChanged());

        this._data.desktopCoordinates = [];

        /*
         * This callback allows to detect a change in the working area (like when changing the Zoom value)
         */
        this._data.sizeChangedId = global.window_manager.connect(
            'size-changed', () => this._reloadIfSizesChanged());

        this._data.isEnabled = true;
        if (this._data.launchDesktopId) {
            GLib.source_remove(this._data.launchDesktopId);
            this._data.launchDesktopId = 0;
        }
        this._launchDesktop();
    }

    /**
     * Disables the extension
     */
    disable() {
        this._data.isEnabled = false;
        this._killCurrentProcess();
        if (this._data.x11Manager)
            this._data.x11Manager.disable();

        // disconnect signals only if connected
        if (this._data.startupPreparedId) {
            Main.layoutManager.disconnect(this._data.startupPreparedId);
            this._data.startupPreparedId = 0;
        }
        if (this._data.monitorsChangedId) {
            Main.layoutManager.disconnect(this._data.monitorsChangedId);
            this._data.monitorsChangedId = 0;
        }
        if (this._data.workareasChangedId) {
            global.display.disconnect(this._data.workareasChangedId);
            this._data.workareasChangedId = 0;
        }
        if (this._data.sizeChangedId) {
            global.window_manager.disconnect(this._data.sizeChangedId);
            this._data.sizeChangedId = 0;
        }
        if (this._data.launchDesktopId) {
            GLib.source_remove(this._data.launchDesktopId);
            this._data.launchDesktopId = 0;
        }
    }

    _reloadIfSizesChanged() {
        if (!this._data.desktopCoordinates ||
            this._data.desktopCoordinates.length !== Main.layoutManager.monitors.length) {
            this._killCurrentProcess();
            return;
        }
        for (let monitorIndex = 0; monitorIndex < Main.layoutManager.monitors.length; monitorIndex++) {
            const ws = global.workspace_manager.get_workspace_by_index(0);
            const area = ws.get_work_area_for_monitor(monitorIndex);
            const area2 = this._data.desktopCoordinates[monitorIndex];
            const scale = Main.layoutManager.monitors[monitorIndex].geometry_scale;
            if ((area.x !== area2.x) ||
                (area.y !== area2.y) ||
                (area.width !== area2.width) ||
                (area.height !== area2.height) ||
                (scale !== area2.zoom)) {
                this._killCurrentProcess();
                return;
            }
        }
    }

    /**
     * Kills the current desktop program
     */
    _killCurrentProcess() {
        // If a reload was pending, kill it and program a new reload
        if (this._data.launchDesktopId) {
            GLib.source_remove(this._data.launchDesktopId);
            this._data.launchDesktopId = 0;
            if (this._data.isEnabled) {
                this._data.launchDesktopId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT, this._data.reloadTime, () => {
                        this._data.launchDesktopId = 0;
                        this._launchDesktop();
                        return GLib.SOURCE_REMOVE;
                    });
            }
        }

        // kill the desktop program. It will be reloaded automatically.
        if (this._data.currentProcess && this._data.currentProcess.subprocess) {
            this._data.currentProcess.cancellable?.cancel();
            try {
                this._data.currentProcess.subprocess.send_signal(15);
            } catch (e) {
                console.warn(`Desktop Icons: Neo: failed to kill desktop process: ${e.message}`);
            }
        }
    }

    /**
     * This function checks all the processes in the system and kills those
     * that are a desktop manager from the current user (but not others).
     * This allows to avoid having several ones in case gnome shell resets,
     * or other odd cases. It requires the /proc virtual filesystem, but
     * doesn't fail if it doesn't exist.
     */
    _doKillAllOldDesktopProcesses() {
        const procFolder = Gio.File.new_for_path('/proc');
        if (!procFolder.query_exists(null)) {
            return;
        }

        let fileEnum;
        try {
            fileEnum = procFolder.enumerate_children(
                'standard::*', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return;
        }
        let info;
        while ((info = fileEnum.next_file(null))) {
            const filename = info.get_name();
            if (!filename) {
                break;
            }
            const processPath = GLib.build_filenamev(['/proc', filename, 'cmdline']);
            const processUser = Gio.File.new_for_path(processPath);
            if (!processUser.query_exists(null)) {
                continue;
            }
            try {
                const [bytes] = processUser.load_bytes(null);
                const raw = bytes.get_data();
                let contents = '';
                for (let i = 0; i < raw.length; i++) {
                    if (raw[i] < 32) {
                        contents += ' ';
                    } else {
                        contents += String.fromCharCode(raw[i]);
                    }
                }
                const path = `gjs ${GLib.build_filenamev([this.path, 'desktopicons-neo.js'])}`;
                if (contents.startsWith(path)) {
                    const proc = new Gio.Subprocess({argv: ['/bin/kill', filename]});
                    proc.init(null);
                    proc.wait(null);
                }
            } catch (e) {
                // process may have exited meanwhile; ignore
            }
        }
    }

    _doRelaunch(reloadTime) {
        this._data.currentProcess = null;
        if (this._data.x11Manager)
            this._data.x11Manager.set_wayland_client(null);
        if (this._data.isEnabled) {
            if (this._data.launchDesktopId) {
                GLib.source_remove(this._data.launchDesktopId);
            }
            this._data.launchDesktopId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, reloadTime, () => {
                    this._data.launchDesktopId = 0;
                    this._launchDesktop();
                    return GLib.SOURCE_REMOVE;
                });
        }
    }

    /**
     * Launches the desktop program, passing to it the current desktop geometry for each monitor
     * and the path where it is stored. It also monitors it, to relaunch it in case it dies or is
     * killed. Finally, it reads STDOUT and STDERR and redirects them to the journal, to help to
     * debug it.
     */
    _launchDesktop() {
        this._data.reloadTime = 100;
        const argv = [];
        argv.push(GLib.build_filenamev([this.path, 'desktopicons-neo.js']));
        // Specify that it must work as true desktop
        argv.push('-E');
        // The path. Allows the program to find translations, settings and modules.
        argv.push('-P');
        argv.push(this.path);

        let first = true;

        this._data.desktopCoordinates = [];
        argv.push('-M');
        argv.push(`${Main.layoutManager.primaryIndex}`);

        for (let monitorIndex = 0; monitorIndex < Main.layoutManager.monitors.length; monitorIndex++) {
            const ws = global.workspace_manager.get_workspace_by_index(0);
            const area = ws.get_work_area_for_monitor(monitorIndex);
            // send the working area of each monitor in the desktop
            argv.push('-D');
            const scale = Main.layoutManager.monitors[monitorIndex].geometry_scale;
            argv.push(`${area.x}:${area.y}:${area.width}:${area.height}:${scale}`);
            this._data.desktopCoordinates.push(
                {x: area.x, y: area.y, width: area.width, height: area.height, zoom: scale});
            if (first || (area.x < this._data.minx)) {
                this._data.minx = area.x;
            }
            if (first || (area.y < this._data.miny)) {
                this._data.miny = area.y;
            }
            if (first || ((area.x + area.width) > this._data.maxx)) {
                this._data.maxx = area.x + area.width;
            }
            if (first || ((area.y + area.height) > this._data.maxy)) {
                this._data.maxy = area.y + area.height;
            }
            first = false;
        }

        this._data.currentProcess = new LaunchSubprocess(0, 'Desktop Icons: Neo');
        this._data.currentProcess.set_cwd(GLib.get_home_dir());
        if (this._data.currentProcess.spawnv(argv) === null) {
            this._doRelaunch(1000);
            return;
        }
        if (this._data.x11Manager)
            this._data.x11Manager.set_wayland_client(this._data.currentProcess);
        this._data.launchTime = GLib.get_monotonic_time();

        /*
         * If the desktop process dies, wait 100ms and relaunch it, unless the exit status is different than
         * zero or it died too fast, in which case it will wait one second. This is done this way to avoid
         * relaunching the desktop too fast if it has a bug that makes it fail continuously, avoiding filling
         * the journal too fast.
         */
        this._data.currentProcess.subprocess.wait_async(null, (obj, res) => {
            let reloadTime = 100;
            try {
                obj.wait_finish(res);
            } catch (e) {
                reloadTime = 1000;
            }
            if (!this._data.currentProcess || obj !== this._data.currentProcess.subprocess) {
                return;
            }
            const delta = GLib.get_monotonic_time() - this._data.launchTime;
            if (delta < 1000000) {
                reloadTime = 1000;
            } else if (obj.get_if_exited()) {
                const retval = obj.get_exit_status();
                if (retval !== 0) {
                    reloadTime = 1000;
                }
            } else {
                reloadTime = 1000;
            }
            this._data.reloadTime = reloadTime;
            this._doRelaunch(reloadTime);
        });
    }
}

/**
 * This class encapsulates the code to launch a subprocess that can detect whether a window belongs to it
 * It only accepts to do it under Wayland, because under X11 there is no need to do these tricks
 *
 * Supports both the legacy Meta.WaylandClient.new() API (GNOME <= 48) and the new
 * Meta.WaylandClient.new_subprocess() API (GNOME >= 49, https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/4491).
 * On GNOME >= 49, show/hide window-list moved to Meta.Window, handled in emulateX11WindowType.js.
 */
class LaunchSubprocess {
    constructor(flags, process_id) {
        this._process_id = process_id;
        this.cancellable = new Gio.Cancellable();
        this._flags = flags | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE;
        this._launcher = new Gio.SubprocessLauncher({flags: this._flags});
        this.subprocess = null;
        this.process_running = false;
        this._launch_timer = 0;
        this._waiting_for_windows = 0;
        this._waylandClient = null;
    }

    spawnv(argv) {
        try {
            if (_isWayland()) {
                if (Meta.WaylandClient.new_subprocess) {
                    // GNOME 49+ API
                    this._waylandClient = Meta.WaylandClient.new_subprocess(
                        global.context, this._launcher, argv);
                    this.subprocess = this._waylandClient.get_subprocess();
                } else {
                    // Legacy APIs (GNOME <= 48)
                    try {
                        this._waylandClient = Meta.WaylandClient.new(this._launcher);
                    } catch (e) {
                        // Intermediate API (some 44-48 builds)
                        this._waylandClient = Meta.WaylandClient.new(
                            global.context, this._launcher);
                    }
                    this.subprocess = this._waylandClient.spawnv(global.display, argv);
                }
            } else {
                this.subprocess = this._launcher.spawnv(argv);
            }
        } catch (e) {
            console.error(`Desktop Icons: Neo: error launching desktop process: ${e.message}\n${e.stack}`);
            this.subprocess = null;
        }
        // Gio.SubprocessLauncher.close() exists on GLib >= 2.68
        if (this._launcher?.close) {
            try {
                this._launcher.close();
            } catch (e) {
                // ignore
            }
        }
        this._launcher = null;
        if (this.subprocess) {
            /*
             * It reads STDOUT and STDERR and sends it to the journal. This allows to
             * have any error from the desktop app in the same journal than other extensions.
             */
            this._dataInputStream = Gio.DataInputStream.new(
                this.subprocess.get_stdout_pipe());
            this._readOutput();
            this.subprocess.wait_async(this.cancellable, () => {
                this.process_running = false;
                this._dataInputStream = null;
                if (this._launch_timer !== 0) {
                    GLib.source_remove(this._launch_timer);
                    this._launch_timer = 0;
                    this._waiting_for_windows = 0;
                }
            });
            this.process_running = true;
            if (_isWayland() && Main.layoutManager.monitors.length !== 0) {
                // If the desktop window isn't detected in 3s, kill and relaunch.
                this._waiting_for_windows = Main.layoutManager.monitors.length;
                this._launch_timer = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT, 3000, () => {
                        this._launch_timer = 0;
                        try {
                            this.subprocess.force_exit();
                        } catch (e) {
                            // ignore
                        }
                        return GLib.SOURCE_REMOVE;
                    });
            }
        }
        return this.subprocess;
    }

    cancel_timer() {
        if (this._launch_timer !== 0) {
            GLib.source_remove(this._launch_timer);
            this._launch_timer = 0;
            this._waiting_for_windows = 0;
        }
    }

    set_cwd(cwd) {
        this._launcher.set_cwd(cwd);
    }

    _readOutput() {
        if (!this._dataInputStream) {
            return;
        }
        this._dataInputStream.read_line_async(
            GLib.PRIORITY_DEFAULT, this.cancellable, (object, res) => {
                try {
                    const [output, length] = object.read_line_finish_utf8(res);
                    if (length) {
                        console.log(`${this._process_id}: ${output}`);
                    }
                } catch (e) {
                    if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        return;
                    }
                    console.error(e, `${this._process_id}_Error`);
                }
                this._readOutput();
            });
    }

    /**
     * Queries whether the passed window belongs to the launched subprocess or not.
     * @param {MetaWindow} window The window to check.
     */
    query_window_belongs_to(window) {
        if (!_isWayland()) {
            return false;
        }
        if (!this.process_running || !this._waylandClient) {
            return false;
        }
        try {
            const ownsWindow = this._waylandClient.owns_window(window);
            if (ownsWindow && this._launch_timer !== 0 && this._waiting_for_windows !== 0) {
                this._waiting_for_windows--;
                if (this._waiting_for_windows === 0) {
                    GLib.source_remove(this._launch_timer);
                    this._launch_timer = 0;
                }
            }
            return ownsWindow;
        } catch (e) {
            return false;
        }
    }

    show_in_window_list(window) {
        if (_isWayland() && this.process_running) {
            try {
                if (window.show_in_window_list) {
                    // GNOME 49+: API moved to Meta.Window
                    window.show_in_window_list();
                } else if (this._waylandClient) {
                    this._waylandClient.show_in_window_list(window);
                }
            } catch (e) {
                // ignore
            }
        }
    }

    hide_from_window_list(window) {
        if (_isWayland() && this.process_running) {
            try {
                if (window.hide_from_window_list) {
                    // GNOME 49+: API moved to Meta.Window
                    window.hide_from_window_list();
                } else if (this._waylandClient) {
                    this._waylandClient.hide_from_window_list(window);
                }
            } catch (e) {
                // ignore
            }
        }
    }
}
