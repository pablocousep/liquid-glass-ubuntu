// Liquid Glass — extensión única.
//
// Arranca, en este orden:
//   1. Las extensiones incluidas en bundled/ (dash-to-dock, blur-my-shell,
//      rounded-windows), igual que lo haría GNOME: cada una con sus ajustes,
//      traducciones y hoja de estilos.
//   2. La capa propia de Liquid Glass: impl/impl-NNN.js (la más reciente) y
//      impl/style-NNN.css. Cada versión tiene un nombre distinto para poder
//      recargar en caliente con `gnome-extensions disable/enable`.
//
// Depuración (desactivada por defecto): sólo si existe el archivo
// ~/.config/liquid-glass/debug, crear ~/.cache/liquid-glass/shot guarda una
// captura en ~/.cache/liquid-glass/shot.png.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot');

const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'liquid-glass']);

// Orden de arranque: el dock antes que blur-my-shell, para que éste lo encuentre.
// lock: si sigue activa en la pantalla de bloqueo (como hacía cada una suelta).
const BUNDLED = [
    {uuid: 'dash-to-dock@micxgx.gmail.com', lock: false},
    {uuid: 'blur-my-shell@aunetx', lock: true},
    {uuid: 'rounded-windows@marcosgt.github.io', lock: false},
];

function isLocked() {
    return Main.sessionMode.isLocked || Main.sessionMode.currentMode === 'unlock-dialog';
}

function newest(dir, prefix, suffix) {
    const names = [];
    try {
        const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null))) {
            const n = info.get_name();
            if (n.startsWith(prefix) && n.endsWith(suffix))
                names.push(n);
        }
    } catch (e) {
        console.warn(`[liquid-glass] ${e}`);
    }
    names.sort();
    return names.length ? dir.get_child(names[names.length - 1]) : null;
}

function theme() {
    return St.ThemeContext.get_for_stage(global.stage).get_theme();
}

export default class LiquidGlass extends Extension {
    async enable() {
        this._enabled = true;
        this._setupDebugMonitor();
        this._patchLookup();
        await this._enableBundled();
        // En la pantalla de bloqueo sólo siguen las partes que tiene sentido
        // mantener (cristal y estilos); el dock y las esquinas se apagan.
        Main.sessionMode.connectObject('updated', () => this._syncLock(), this);
        if (!this._enabled)
            return;
        await this._enableOwn();
    }

    disable() {
        this._enabled = false;
        Main.sessionMode.disconnectObject(this);

        try {
            this._impl?.disable();
        } catch (e) {
            console.error(`[liquid-glass] error desactivando la capa propia: ${e}\n${e.stack}`);
        }
        this._impl = null;
        if (this._cssFile) {
            theme().unload_stylesheet(this._cssFile);
            this._cssFile = null;
        }

        for (const sub of (this._subs ?? []).reverse()) {
            try {
                if (sub.active)
                    sub.obj?.disable();
                sub.active = false;
            } catch (e) {
                console.error(`[liquid-glass] error desactivando ${sub.uuid}: ${e}\n${e.stack}`);
            }
            if (sub.css)
                theme().unload_stylesheet(sub.css);
        }
        this._subs = null;
        this._locked = false;

        this._unpatchLookup();
        this._monitor?.cancel();
        this._monitor = null;
    }

    // ---- extensiones incluidas -------------------------------------------

    // Las extensiones buscan su propio objeto con Extension.lookupByURL(),
    // que sube por las carpetas preguntando por cada UUID. Hacemos que los
    // UUID de las incluidas devuelvan su objeto, no el de Liquid Glass.
    _patchLookup() {
        this._bundled = new Map();
        this._origLookup = Extension.lookupByUUID;
        const orig = this._origLookup;
        const bundled = this._bundled;
        Extension.lookupByUUID = function (uuid) {
            return bundled.get(uuid) ?? orig.call(this, uuid);
        };
    }

    _unpatchLookup() {
        if (this._origLookup) {
            Extension.lookupByUUID = this._origLookup;
            this._origLookup = null;
        }
        this._bundled = null;
    }

    _syncLock() {
        const locked = isLocked();
        if (locked === this._locked)
            return;
        this._locked = locked;
        for (const sub of this._subs ?? []) {
            if (sub.lock || !sub.obj)
                continue;
            try {
                if (locked && sub.active) {
                    sub.obj.disable();
                    sub.active = false;
                } else if (!locked && !sub.active) {
                    Promise.resolve(sub.obj.enable()).catch(e => console.error(`[liquid-glass] ${sub.uuid}: ${e}`));
                    sub.active = true;
                }
            } catch (e) {
                console.error(`[liquid-glass] ${sub.uuid} (bloqueo): ${e}\n${e.stack}`);
            }
        }
    }

    async _enableBundled() {
        this._subs = [];
        this._locked = isLocked();
        const base = this.dir.get_child('bundled');
        for (const {uuid, lock} of BUNDLED) {
            const dir = base.get_child(uuid);
            const sub = {uuid, lock, obj: null, css: null, active: false};
            try {
                const [, bytes] = dir.get_child('metadata.json').load_contents(null);
                const metadata = JSON.parse(new TextDecoder().decode(bytes));
                const mod = await import(dir.get_child('extension.js').get_uri());
                if (!this._enabled)
                    return;
                sub.obj = new mod.default({...metadata, dir, path: dir.get_path()});
                this._bundled.set(uuid, sub.obj);

                const css = dir.get_child('stylesheet.css');
                if (css.query_exists(null)) {
                    theme().load_stylesheet(css);
                    sub.css = css;
                }

                if (lock || !this._locked) {
                    await sub.obj.enable();
                    sub.active = true;
                    console.log(`[liquid-glass] incluida ${uuid} activada`);
                }
            } catch (e) {
                console.error(`[liquid-glass] no se pudo activar ${uuid}: ${e}\n${e.stack}`);
            }
            this._subs.push(sub);
        }
    }

    // ---- capa propia --------------------------------------------------------

    async _enableOwn() {
        const implDir = this.dir.get_child('impl');
        const cssFile = newest(implDir, 'style-', '.css');
        if (cssFile) {
            this._cssFile = cssFile;
            theme().load_stylesheet(cssFile);
        }

        const jsFile = newest(implDir, 'impl-', '.js');
        if (!jsFile)
            return;
        try {
            const mod = await import(jsFile.get_uri());
            if (!this._enabled)
                return;
            this._impl = new mod.default(this);
            this._impl.enable();
            console.log(`[liquid-glass] cargado ${jsFile.get_basename()}`);
        } catch (e) {
            console.error(`[liquid-glass] error cargando ${jsFile.get_basename()}: ${e}\n${e.stack}`);
        }
    }

    // ---- depuración: capturas -------------------------------------------------

    _setupDebugMonitor() {
        const flag = GLib.build_filenamev([GLib.get_user_config_dir(), 'liquid-glass', 'debug']);
        if (!GLib.file_test(flag, GLib.FileTest.EXISTS))
            return;
        GLib.mkdir_with_parents(CACHE_DIR, 0o700);
        const dir = Gio.File.new_for_path(CACHE_DIR);
        this._monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', (_m, file, _other, event) => {
            if (event !== Gio.FileMonitorEvent.CREATED || file.get_basename() !== 'shot')
                return;
            try {
                file.delete(null);
            } catch (_e) {}
            this._shoot().catch(e => console.error(`[liquid-glass] captura: ${e}`));
        });
    }

    async _shoot() {
        const out = Gio.File.new_for_path(GLib.build_filenamev([CACHE_DIR, 'shot.png']));
        const tmp = Gio.File.new_for_path(GLib.build_filenamev([CACHE_DIR, 'shot.tmp.png']));
        const stream = tmp.replace(null, false, Gio.FileCreateFlags.NONE, null);
        const shooter = new Shell.Screenshot();
        await shooter.screenshot(false, stream);
        stream.close(null);
        tmp.move(out, Gio.FileCopyFlags.OVERWRITE, null, null);
    }
}
