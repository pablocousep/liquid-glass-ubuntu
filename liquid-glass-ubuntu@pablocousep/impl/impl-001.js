// Liquid Glass — capa de estilo (+ comandos de depuración para capturas).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Carpeta de la extensión (impl/ está dentro de ella).
const EXT_DIR = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();


// ---------------------------------------------------------------------------
// Barra de estado autoocultable: si hay una ventana maximizada en el monitor
// principal, la barra deja de reservar espacio (la app ocupa toda la altura)
// y se esconde; al llevar el ratón al borde superior aparece ENCIMA de la app.
// ---------------------------------------------------------------------------
const ANIM_MS = 200;
const HIDE_DELAY_MS = 800;   // tiempo fuera de la barra antes de esconderla
const HIDE_MARGIN = 60;       // px por debajo de la barra que aún cuentan como "encima"
const REVEAL_DWELL_MS = 250;

class AutoHidePanel {
    enable() {
        const lm = Main.layoutManager;
        this._box = lm.panelBox;
        this._hidden = false;
        this._revealed = false;
        this._pollId = 0;
        this._laterId = 0;

        // Franja de 1px en el borde superior para mostrar la barra.
        this._hot = new St.Widget({name: 'lgPanelHotZone', reactive: true, visible: false});
        lm.addChrome(this._hot, {affectsStruts: false, trackFullscreen: true});
        // Hay que dejar el ratón arriba un momento (no basta con rozar el
        // borde al ir a las pestañas de una app).
        this._hot.connect('enter-event', () => {
            this._cancelDwell();
            this._dwellId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REVEAL_DWELL_MS, () => {
                this._dwellId = 0;
                const [, y] = global.get_pointer();
                const m = Main.layoutManager.primaryMonitor;
                if (m && y <= m.y + 2)
                    this._reveal();
                return GLib.SOURCE_REMOVE;
            });
        });
        this._hot.connect('leave-event', () => this._cancelDwell());
        this._syncHotZone();
        lm.connectObject('monitors-changed', () => {
            this._syncHotZone();
            this._queueCheck();
        }, this);

        const queue = () => this._queueCheck();
        global.display.connectObject(
            'window-created', (_d, win) => {
                this._watchWindow(win);
                queue();
            },
            'restacked', queue,
            'notify::focus-window', queue,
            'in-fullscreen-changed', queue,
            this);
        global.workspace_manager.connectObject('active-workspace-changed', queue, this);
        Main.overview.connectObject('showing', () => this._show(true), 'hidden', queue, this);
        for (const actor of global.get_window_actors())
            this._watchWindow(actor.meta_window);

        this._queueCheck();
    }

    _watchWindow(win) {
        if (!win)
            return;
        const queue = () => this._queueCheck();
        win.connectObject(
            'size-changed', queue,
            'position-changed', queue,
            'notify::minimized', queue,
            'workspace-changed', queue,
            'unmanaged', queue,
            this);
    }

    _cancelDwell() {
        if (this._dwellId) {
            GLib.source_remove(this._dwellId);
            this._dwellId = 0;
        }
    }

    _syncHotZone() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        this._hot.set_position(m.x, m.y);
        this._hot.set_size(m.width, 1);
    }

    _queueCheck() {
        if (this._laterId)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            this._check();
            return false;
        });
    }

    _hasMaximized() {
        const ws = global.workspace_manager.get_active_workspace();
        const primary = Main.layoutManager.primaryIndex;
        return ws.list_windows().some(w =>
            !w.minimized &&
            w.get_monitor() === primary &&
            w.get_window_type() === Meta.WindowType.NORMAL &&
            !w.is_hidden?.() &&
            (w.is_maximized?.() ?? (w.maximized_horizontally && w.maximized_vertically)));
    }

    _check() {
        if (Main.overview.visible) {
            this._show(true);
            return;
        }
        const shouldHide = this._hasMaximized();
        this._setStruts(!shouldHide);
        this._hot.visible = shouldHide;
        if (shouldHide && !this._revealed)
            this._hide();
        else if (!shouldHide)
            this._show(true); // fija, no "desplegada": así se vuelve a esconder al maximizar
    }

    _setStruts(on) {
        const lm = Main.layoutManager;
        const i = lm._findActor(this._box);
        if (i === -1)
            return;
        const data = lm._trackedActors[i];
        if (data.affectsStruts !== on) {
            data.affectsStruts = on;
            lm._queueUpdateRegions();
        }
    }

    _hide() {
        if (this._hidden && !this._revealed && this._box.translation_y === -this._box.height)
            return;
        this._hidden = true;
        this._revealed = false;
        this._stopPoll();
        this._box.remove_all_transitions();
        this._box.ease({
            translation_y: -this._box.height,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _show(permanent) {
        this._revealed = !permanent;
        this._hidden = false;
        if (permanent) {
            this._stopPoll();
            this._hot.visible = false;
            this._setStruts(true);
        }
        this._box.remove_all_transitions();
        this._box.ease({
            translation_y: 0,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _reveal() {
        if (!this._hidden)
            return;
        this._show(false);
        this._startPoll();
    }

    // Mientras está desplegada sobre la app, se vuelve a esconder cuando el
    // ratón se aleja y no hay ningún menú de la barra abierto.
    _startPoll() {
        this._stopPoll();
        let awaySince = 0;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            const [, y] = global.get_pointer();
            const limit = this._box.y + this._box.height + HIDE_MARGIN;
            const menuOpen = !!Main.panel.menuManager.activeMenu;
            if (y > limit && !menuOpen) {
                awaySince ||= GLib.get_monotonic_time();
                if (GLib.get_monotonic_time() - awaySince > HIDE_DELAY_MS * 1000) {
                    this._pollId = 0;
                    this._revealed = false;
                    this._check();
                    return GLib.SOURCE_REMOVE;
                }
            } else {
                awaySince = 0;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPoll() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
    }

    disable() {
        this._stopPoll();
        this._cancelDwell();
        if (this._laterId) {
            global.compositor.get_laters().remove(this._laterId);
            this._laterId = 0;
        }
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._box.disconnectObject(this);
        for (const actor of global.get_window_actors())
            actor.meta_window?.disconnectObject(this);
        this._setStruts(true);
        this._box.remove_all_transitions();
        this._box.translation_y = 0;
        Main.layoutManager.removeChrome(this._hot);
        this._hot.destroy();
        this._hot = null;
    }
}

// ---------------------------------------------------------------------------
// Botón "Mostrar aplicaciones" separado, en la esquina inferior izquierda.
// Mismo cristal que el dock (pipeline de blur-my-shell del dock), misma
// altura y radio, y se oculta/aparece a la vez que dash-to-dock.
// ---------------------------------------------------------------------------
const APPS_ICON_SIZE = 40;

class AppsCornerButton {
    enable() {
        this._size = 66;
        this._radius = 26;
        this._gap = 4;
        this._shown = true;

        this._frame = new St.Widget({
            name: 'lgAppsFrame',
            style_class: 'lg-apps-frame',
            reactive: false,
            layout_manager: new Clutter.BinLayout(),
        });
        this._button = new St.Button({
            style_class: 'lg-apps-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            y_expand: true,
            child: new St.Icon({
                icon_name: `view-app-grid-${Main.sessionMode.currentMode}-symbolic`,
                fallback_icon_name: 'view-app-grid-symbolic',
                icon_size: APPS_ICON_SIZE,
            }),
        });
        this._button.connect('clicked', () => {
            if (Main.overview.visible)
                Main.overview.hide();
            else
                Main.overview.showApps();
        });
        this._frame.add_child(this._button);
        Main.layoutManager.addChrome(this._frame, {affectsStruts: false, trackFullscreen: true});

        // Franja de 1px en el borde inferior, bajo el botón: al llegar el
        // ratón, aparece (igual que el dock en su zona).
        this._hot = new St.Widget({name: 'lgAppsHotZone', reactive: true, visible: false});
        Main.layoutManager.addChrome(this._hot, {affectsStruts: false, trackFullscreen: true});
        this._hot.connect('enter-event', () => {
            this._forced = true;
            this._applySlide(true);
        });
        // Mientras el ratón esté encima no se esconde; al salir, vuelve al
        // estado del dock.
        this._button.connect('notify::hover', () => {
            if (this._button.hover)
                this._forced = true;
            else
                this._followDock();
        });
        this._frame.set_size(this._size, this._size);

        Main.overview.connectObject(
            'showing', () => this._button.add_style_pseudo_class('checked'),
            'hiding', () => this._button.remove_style_pseudo_class('checked'),
            this);
        Main.layoutManager.connectObject('monitors-changed', () => this._findDock(), this);
        Main.uiGroup.connectObject('child-added', (_g, child) => {
            if (child.get_name?.() === 'dashtodockContainer')
                this._findDock();
        }, this);

        this._findDock();
        this._attachGlass().catch(e => console.warn(`[liquid-glass] cristal del botón: ${e}`));
    }

    _findDock() {
        this._dock?.disconnectObject?.(this);
        const docks = Main.uiGroup.get_children().filter(a => a.get_name?.() === 'dashtodockContainer');
        this._dock = docks.find(d => d.monitorIndex === Main.layoutManager.primaryIndex) ?? docks[0] ?? null;
        if (this._dock) {
            this._dock.connectObject(
                'notify::dock-state', () => this._followDock(),
                'destroy', () => {
                    this._dock = null;
                },
                this);
        }
        // El botón sigue fotograma a fotograma el deslizamiento del dock
        // (propiedad slide-x de su contenedor: 1 visible, 0 escondido), así
        // suben y bajan exactamente a la vez.
        this._slider?.disconnectObject?.(this);
        this._slider = this._dock?._slider ?? null;
        this._slider?.connectObject('notify::slide-x', () => this._applySlide(), this);
        this._measure();
        this._applySlide();
    }

    _followDock() {
        // Al salir el ratón del botón, deja de forzarse y vuelve a seguir al dock.
        if (this._forced && !this._button?.hover) {
            const st = this._dock?.dockState;
            if (!(st === 1 || st === 2)) {
                this._forced = false;
                this._applySlide(true);
            }
        }
    }

    _slide() {
        return this._slider ? this._slider.slideX : 1;
    }

    // animate: sólo para cuando el botón se muestra/oculta por su cuenta
    // (zona de la esquina); siguiendo al dock se aplica directamente.
    _applySlide(animate = false) {
        if (!this._frame)
            return;
        const hidden = this._size + this._gap + 20;
        const slide = this._forced ? 1 : this._slide();
        const target = Math.round((1 - slide) * hidden);
        if (this._hot)
            this._hot.visible = !this._forced && slide < 0.5;
        this._frame.remove_all_transitions();
        if (animate) {
            this._frame.ease({translation_y: target, duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            this._frame.translation_y = target;
        }
        if (slide >= 1 && !this._measured) {
            this._measured = true;
            this._measure();
        }
    }

    // Toma tamaño y separación del fondo del dock para que coincidan.
    _measure() {
        try {
            const bg = this._dock?.dash?._background;
            if (bg && bg.height > 10) {
                this._size = Math.round(bg.height);
                const m = Main.layoutManager.primaryMonitor;
                const [, by] = bg.get_transformed_position();
                const gap = Math.round(m.y + m.height - (by + bg.height) - (this._dock.translation_y ?? 0));
                if (gap >= 0 && gap < 40)
                    this._gap = gap;
            }
        } catch (_e) {}
        this._frame.set_size(this._size, this._size);
        this._position();
    }

    _position() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const margin = Math.max(this._gap, 8);
        this._frame.set_position(m.x + margin, m.y + m.height - this._size - this._gap);
        this._hot?.set_position(m.x, m.y + m.height - 1);
        this._hot?.set_size(this._size + margin * 2, 1);
    }

    _dtdSettings() {
        if (this._dtd !== undefined)
            return this._dtd;
        try {
            const dir = EXT_DIR.get_child('bundled').get_child('dash-to-dock@micxgx.gmail.com').get_child('schemas').get_path();
            const src = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
            this._dtd = new Gio.Settings({settings_schema: src.lookup('org.gnome.shell.extensions.dash-to-dock', false)});
        } catch (_e) {
            this._dtd = null;
        }
        return this._dtd;
    }

    async _attachGlass() {
        const blur = global.blur_my_shell;
        if (!blur?._effects_manager || !blur?._pipelines_manager)
            return;
        const [{DynamicPipeline}, {get_pipeline_id}] = await Promise.all([
            import(blur.dir.get_child('render').get_child('dynamic_surface.js').get_uri()),
            import(blur.dir.get_child('conveniences').get_child('style.js').get_uri()),
        ]);
        if (!this._frame || global.blur_my_shell !== blur)
            return;
        const dockSettings = blur._settings.dash_to_dock;
        this._glass = new DynamicPipeline(blur._effects_manager, blur._pipelines_manager,
            get_pipeline_id(dockSettings), {corner_radius: this._radius, get_corners: () => 0});
        this._glass.attach_to_container(this._frame, 'lg-apps-glass');
        this._frame.set_child_below_sibling(this._frame.get_children().find(c => c !== this._button), null);
        const update = () => this._glass?.change_pipeline_to(get_pipeline_id(dockSettings));
        this._dockSettings = dockSettings.settings;
        this._dockSettings.connectObject('changed', update, this);
    }

    disable() {
        this._dockSettings?.disconnectObject(this);
        this._slider?.disconnectObject?.(this);
        this._slider = null;
        this._dock?.disconnectObject?.(this);
        Main.overview.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        Main.uiGroup.disconnectObject(this);
        this._glass?.destroy?.();
        this._glass = null;
        if (this._hot) {
            Main.layoutManager.removeChrome(this._hot);
            this._hot.destroy();
            this._hot = null;
        }
        if (this._frame) {
            Main.layoutManager.removeChrome(this._frame);
            this._frame.destroy();
        }
        this._frame = this._button = this._dock = null;
    }
}

// ---------------------------------------------------------------------------
// Terminal (Ptyxis) maximizada: la app controla su propia transparencia y no
// deja que gtk.css la cambie, así que ponemos una capa opaca dentro de su
// ventana, justo detrás del contenido, sólo mientras esa ventana esté
// maximizada / a pantalla completa. Las demás terminales siguen de cristal.
// ---------------------------------------------------------------------------
const TERM_SOLID_DARK = 'background-color: rgb(28, 28, 32);';
const TERM_SOLID_LIGHT = 'background-color: rgb(255, 255, 255);';

class TerminalBacking {
    enable() {
        this._tracked = new Map();
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._iface.connectObject('changed::color-scheme', () => this._recolor(), this);
        global.display.connectObject('window-created', (_d, w) => {
            global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._track(w);
                return false;
            });
        }, this);
        for (const a of global.get_window_actors())
            this._track(a.meta_window);
    }

    _color() {
        return this._iface.get_string('color-scheme') === 'prefer-dark' ? TERM_SOLID_DARK : TERM_SOLID_LIGHT;
    }

    _track(w) {
        if (!w || this._tracked.has(w) || w.get_wm_class() !== 'org.gnome.Ptyxis')
            return;
        const actor = w.get_compositor_private();
        if (!actor)
            return;
        const entry = {actor, backing: null};
        this._tracked.set(w, entry);
        const update = () => this._update(w);
        w.connectObject('size-changed', update, 'notify::fullscreen', update,
            'notify::maximized-horizontally', update, 'notify::maximized-vertically', update,
            'unmanaged', () => this._untrack(w), this);
        update();
    }

    _update(w) {
        const entry = this._tracked.get(w);
        if (!entry)
            return;
        const solid = w.fullscreen || (w.is_maximized?.() ?? (w.maximized_horizontally && w.maximized_vertically));
        if (!solid) {
            entry.backing?.destroy();
            entry.backing = null;
            return;
        }
        if (!entry.backing) {
            entry.backing = new St.Widget({name: 'lgTermBacking', reactive: false,
                style: this._color()});
            // Justo debajo del contenido de la ventana (el último hijo), y por
            // encima del desenfoque de blur-my-shell si lo hay.
            const surface = entry.actor.get_last_child();
            entry.actor.insert_child_below(entry.backing, surface);
        }
        const frame = w.get_frame_rect();
        const buffer = w.get_buffer_rect();
        entry.backing.set_position(frame.x - buffer.x, frame.y - buffer.y);
        entry.backing.set_size(frame.width, frame.height);
    }

    _recolor() {
        for (const entry of this._tracked.values())
            entry.backing?.set_style(this._color());
    }

    _untrack(w) {
        const entry = this._tracked.get(w);
        this._tracked.delete(w);
        w.disconnectObject(this);
        try {
            entry?.backing?.destroy();
        } catch (_e) {}
    }

    disable() {
        global.display.disconnectObject(this);
        this._iface?.disconnectObject(this);
        for (const w of [...(this._tracked?.keys() ?? [])])
            this._untrack(w);
        this._tracked = null;
    }
}

// ---------------------------------------------------------------------------
// Instalación: la extensión es autónoma. La primera vez (o cuando cambia
// SETUP_VERSION) aplica los ajustes guardados en
// settings/*.ini (blur-my-shell, dash-to-dock, rounded-windows), desactiva el
// dock de Ubuntu (choca con dash-to-dock) y deja la terminal de cristal.
// Después respeta lo que cambies a mano.
// ---------------------------------------------------------------------------
const SETUP_VERSION = '1';
const SETTINGS_PATHS = {
    'blur-my-shell.ini': '/org/gnome/shell/extensions/blur-my-shell/',
    'dash-to-dock.ini': '/org/gnome/shell/extensions/dash-to-dock/',
    'rounded-windows.ini': '/org/gnome/shell/extensions/rounded-windows/',
};

class Setup {
    constructor(ext) {
        this._ext = ext;
        this._stampFile = Gio.File.new_for_path(GLib.build_filenamev(
            [GLib.get_user_data_dir(), 'liquid-glass', 'setup-version']));
    }

    run() {
        let applied = '';
        try {
            applied = new TextDecoder().decode(this._stampFile.load_contents(null)[1]).trim();
        } catch (_e) {}
        if (applied === SETUP_VERSION)
            return;
        this._applySettings();
        this._disableUbuntuDock();
        this._terminalGlass();
        try {
            const dir = this._stampFile.get_parent();
            if (!dir.query_exists(null))
                dir.make_directory_with_parents(null);
            this._stampFile.replace_contents(new TextEncoder().encode(SETUP_VERSION), null, false,
                Gio.FileCreateFlags.NONE, null);
        } catch (e) {
            console.warn(`[liquid-glass] instalación: ${e}`);
        }
        console.log(`[liquid-glass] instalación ${SETUP_VERSION} aplicada`);
    }

    _applySettings() {
        const dir = this._ext.dir.get_child('settings');
        for (const [file, path] of Object.entries(SETTINGS_PATHS)) {
            try {
                const [, bytes] = dir.get_child(file).load_contents(null);
                const proc = Gio.Subprocess.new(['dconf', 'load', path],
                    Gio.SubprocessFlags.STDIN_PIPE);
                proc.communicate_utf8_async(new TextDecoder().decode(bytes), null, null);
            } catch (e) {
                console.warn(`[liquid-glass] ajustes ${file}: ${e}`);
            }
        }
    }

    _disableUbuntuDock() {
        try {
            const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
            const uuid = 'ubuntu-dock@ubuntu.com';
            const disabled = shell.get_strv('disabled-extensions');
            if (!disabled.includes(uuid))
                shell.set_strv('disabled-extensions', [...disabled, uuid]);
            shell.set_strv('enabled-extensions', shell.get_strv('enabled-extensions').filter(u => u !== uuid));
        } catch (e) {
            console.warn(`[liquid-glass] dock de Ubuntu: ${e}`);
        }
    }

    _terminalGlass() {
        try {
            const app = new Gio.Settings({schema_id: 'org.gnome.Ptyxis'});
            const uuid = app.get_string('default-profile-uuid');
            if (!uuid)
                return;
            new Gio.Settings({schema_id: 'org.gnome.Ptyxis.Profile',
                path: `/org/gnome/Ptyxis/Profiles/${uuid}/`}).set_double('opacity', 0.45);
        } catch (_e) {
            // Ptyxis no instalado: nada que hacer
        }
    }
}

export default class LiquidGlassStyle {
    constructor(ext) {
        this._ext = ext;
    }

    enable() {
        try {
            new Setup(this._ext).run();
        } catch (e) {
            console.error(`[liquid-glass] instalación: ${e}\n${e.stack}`);
        }
        Main.panel.add_style_class_name('lg-panel');
        this._setupDebug();

        // Modo claro / oscuro: clase en uiGroup para la hoja de estilos y
        // gtk.css adecuado para las apps.
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._iface.connectObject(
            'changed::color-scheme', () => {
                this._syncScheme();
                this._reloadDesktopIcons();
            },
            this);
        this._syncScheme();

        // Botón de apps y barra autoocultable sólo en la sesión normal; en la
        // pantalla de bloqueo se apagan (la barra queda fija, con su estilo).
        this._parts = null;
        Main.sessionMode.connectObject('updated', () => this._syncParts(), this);
        this._syncParts();

    }


    _syncScheme() {
        const light = this._iface.get_string('color-scheme') !== 'prefer-dark';
        const ui = Main.layoutManager.uiGroup;
        if (light)
            ui.add_style_class_name('lg-light');
        else
            ui.remove_style_class_name('lg-light');

        // blur-my-shell sólo cambia solo algunos componentes; lo forzamos en todos.
        const PIPES = {
            'panel': 'pipeline_web_panel',
            'dash-to-dock': 'pipeline_web_glass',
            'popup': 'pipeline_web_frost',
            'applications': 'pipeline_web_glass',
            'appfolder': 'pipeline_web_frost',
        };
        try {
            const dir = EXT_DIR.get_child('bundled').get_child('blur-my-shell@aunetx').get_child('schemas').get_path();
            const source = Gio.SettingsSchemaSource.new_from_directory(
                dir, Gio.SettingsSchemaSource.get_default(), false);
            for (const [comp, base] of Object.entries(PIPES)) {
                const schema = source.lookup(`org.gnome.shell.extensions.blur-my-shell.${comp}`, false);
                if (!schema)
                    continue;
                const settings = new Gio.Settings({settings_schema: schema});
                const want = light ? `${base}_light` : base;
                if (settings.get_string('pipeline') !== want)
                    settings.set_string('pipeline', want);
            }
        } catch (e) {
            console.warn(`[liquid-glass] blur-my-shell: ${e}`);
        }

        const src = this._ext.dir.get_child(light ? 'gtk-light.css' : 'gtk-dark.css');
        for (const ver of ['gtk-3.0', 'gtk-4.0']) {
            try {
                const dir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), ver]));
                if (!dir.query_exists(null))
                    dir.make_directory_with_parents(null);
                src.copy(dir.get_child('gtk.css'), Gio.FileCopyFlags.OVERWRITE, null, null);
            } catch (e) {
                console.warn(`[liquid-glass] gtk.css ${ver}: ${e}`);
            }
        }
    }

    _syncParts() {
        const locked = Main.sessionMode.isLocked || Main.sessionMode.currentMode === 'unlock-dialog';
        if (locked && this._parts) {
            this._stopParts();
        } else if (!locked && !this._parts) {
            this._parts = [];
            for (const [name, Part] of [['botón de apps', AppsCornerButton], ['autoocultar barra', AutoHidePanel], ['terminal', TerminalBacking]]) {
                const part = new Part();
                try {
                    part.enable();
                    this._parts.push([name, part]);
                } catch (e) {
                    console.error(`[liquid-glass] ${name}: ${e}\n${e.stack}`);
                }
            }
            this._autoHide = this._parts.find(([n]) => n === 'autoocultar barra')?.[1] ?? null;
        }
    }

    _stopParts() {
        for (const [name, part] of (this._parts ?? []).reverse()) {
            try {
                part.disable();
            } catch (e) {
                console.error(`[liquid-glass] ${name}: ${e}`);
            }
        }
        this._parts = null;
        this._autoHide = null;
    }

    // Sólo para desarrollo: con ~/.config/liquid-glass/debug, los archivos
    // cmd-max / cmd-unmax / cmd-state en ~/.cache/liquid-glass ayudan a probar.
    _setupDebug() {
        const flag = GLib.build_filenamev([GLib.get_user_config_dir(), 'liquid-glass', 'debug']);
        if (!GLib.file_test(flag, GLib.FileTest.EXISTS))
            return;
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'liquid-glass']);
        GLib.mkdir_with_parents(dir, 0o700);
        this._dbg = Gio.File.new_for_path(dir).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._dbg.connect('changed', (_m, file, _o, ev) => {
            const name = file.get_basename();
            if (ev !== Gio.FileMonitorEvent.CREATED || !name.startsWith('cmd-'))
                return;
            try {
                file.delete(null);
            } catch (_e) {}
            const w = global.display.focus_window;
            if (name === 'cmd-max')
                w?.maximize();
            else if (name === 'cmd-unmax')
                w?.unmaximize();
            else if (name === 'cmd-state') {
                const apps = this._parts?.find(([n]) => n === 'botón de apps')?.[1];
                const txt = `slide=${apps?._slide?.()} frameTy=${apps?._frame?.translation_y} dockState=${apps?._dock?.dockState} panelTy=${Main.layoutManager.panelBox.translation_y}`;
                GLib.file_set_contents(GLib.build_filenamev([dir, 'state.txt']), txt);
            }
        });
    }

    disable() {
        this._dbg?.cancel();
        this._dbg = null;
        if (this._dingTimeout) {
            GLib.source_remove(this._dingTimeout);
            this._dingTimeout = 0;
        }
        Main.sessionMode.disconnectObject(this);
        this._stopParts();
        this._iface?.disconnectObject(this);
        this._iface = null;
        Main.layoutManager.uiGroup.remove_style_class_name('lg-light');
        this._monitor = null;
        Main.panel.remove_style_class_name('lg-panel');
    }
}
