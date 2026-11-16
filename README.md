# Liquid Glass para Ubuntu

Extensión de GNOME Shell que da a Ubuntu la estética **Liquid Glass** (al estilo de iOS 26), inspirada en
[liquidglass.archisvaze.com](https://liquidglass.archisvaze.com/). Todo va en **una sola extensión**.

- **Dock** de cristal con refracción en el borde. Se oculta cuando hay una ventana maximizada y reaparece al llevar el ratón abajo.
- **Botón de aplicaciones** separado del dock, en la esquina inferior izquierda, con el mismo cristal. Sube y baja a la vez que el dock.
- **Barra superior** en forma de píldora flotante. Con una ventana maximizada se esconde; al dejar el ratón arriba aparece **encima** de la app, sin desplazarla.
- **Ajustes rápidos, menús, calendario, notificaciones, Alt+Tab, diálogos y pantalla de bloqueo** de cristal. Los interruptores activos se ven como cristal iluminado en lugar del azul de acento.
- **Apps GTK y libadwaita** (Archivos, Configuración, terminal…) translúcidas, con desenfoque detrás. Al maximizarlas pasan a ser opacas.
- **Modo claro y oscuro:** todo cambia de gris grafito a gris perla al cambiar de modo en el sistema.

## Requisitos

- **Ubuntu 26.04** con **GNOME Shell 50**. Otras versiones de GNOME no están probadas.
- Sesión **Wayland**, la de por defecto en Ubuntu.
- `git` para descargarla. Si no lo tienes: `sudo apt install git`.

## Instalación

1. Descarga el repositorio:

   ```bash
   git clone https://github.com/pablocousep/liquid-glass-ubuntu.git
   cd liquid-glass-ubuntu
   ```

2. Ejecuta el instalador:

   ```bash
   ./install.sh
   ```

   El instalador:
   - guarda una copia de seguridad de tus ajustes de GNOME Shell y de tus `gtk.css` en `~/.local/share/liquid-glass/backup-…`;
   - desactiva las versiones sueltas de dash-to-dock, blur-my-shell, rounded-windows y el dock de Ubuntu, que chocarían con las incluidas;
   - copia la extensión a `~/.local/share/gnome-shell/extensions/` y la activa.

3. **Cierra sesión y vuelve a entrar.** En Wayland, GNOME solo carga una extensión nueva al iniciar sesión.

La primera vez que se activa, la extensión aplica sola sus ajustes: los efectos de cristal, el comportamiento del dock y la terminal translúcida. Después respeta lo que cambies a mano.

### Instalación manual (sin el script)

```bash
cp -r liquid-glass-ubuntu@pablocousep ~/.local/share/gnome-shell/extensions/
gnome-extensions disable ubuntu-dock@ubuntu.com
```

Cierra sesión, vuelve a entrar y actívala:

```bash
gnome-extensions enable liquid-glass-ubuntu@pablocousep
```

## Desinstalación

```bash
./uninstall.sh
```

Quita la extensión y restaura la última copia de seguridad que hizo `install.sh`. Después, cierra sesión y vuelve a entrar.

Si quieres recuperar el dock de Ubuntu:

```bash
gnome-extensions enable ubuntu-dock@ubuntu.com
```

## Qué toca en tu sistema

- **`~/.config/gtk-3.0/gtk.css` y `~/.config/gtk-4.0/gtk.css`:** los sustituye por la versión clara u oscura del estilo de cristal. Lo vuelve a hacer cada vez que se activa o cambias de modo.
- **Ajustes de dconf** de `blur-my-shell`, `dash-to-dock` y `rounded-windows`. Se aplican una vez, en la primera activación.
- **Opacidad del perfil de Ptyxis** (la terminal): la pone a 0,45. Mientras una terminal está maximizada, la extensión le pone un fondo sólido.
- **Iconos del escritorio:** al cambiar entre claro y oscuro, la extensión los reinicia para que sus menús cambien de estilo.

## Personalización

- **Colores y formas de la Shell:** `liquid-glass-ubuntu@pablocousep/impl/style-001.css`.
- **Estilo de las apps:** `gtk-dark.css` y `gtk-light.css`.
- **Comportamiento** (barra autoocultable, botón de la esquina, terminal…): `impl/impl-001.js`.
- **Efectos de cristal** (desenfoque, refracción, tinte): ajustes de blur-my-shell en `settings/blur-my-shell.ini`, con los efectos *Liquid Glass (web)*.

Si quieres probar cambios sin cerrar sesión, guarda la nueva versión como `impl-002.js` o `style-002.css`; la extensión carga siempre la de número más alto. Después recarga la extensión:

```bash
gnome-extensions disable liquid-glass-ubuntu@pablocousep
```

```bash
gnome-extensions enable liquid-glass-ubuntu@pablocousep
```

## Créditos y licencia

La extensión incluye, sin modificar, estas extensiones de software libre:

- [Dash to Dock](https://github.com/micheleg/dash-to-dock): GPL-2.0 o posterior
- [Blur my Shell](https://github.com/aunetx/blur-my-shell): GPL-3.0
- [Rounded Window Corners](https://github.com/Nathanaelrc/rounded-windows): GPL-3.0

Cada una conserva su licencia dentro de `bundled/`. El efecto visual se inspira en
[liquid-glass](https://github.com/archisvaze/liquid-glass) de Archis Vaze.

El conjunto se distribuye bajo la **GPL-3.0** (ver [`LICENSE`](LICENSE)).
