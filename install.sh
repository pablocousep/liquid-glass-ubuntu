#!/usr/bin/env bash
# Instala la extensión Liquid Glass para GNOME 50 (Ubuntu 26.04).
set -euo pipefail

UUID="liquid-glass-ubuntu@pablocousep"
SRC="$(cd "$(dirname "$0")" && pwd)/$UUID"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
BACKUP="$HOME/.local/share/liquid-glass/backup-$(date +%Y%m%d-%H%M%S)"

if [ ! -d "$SRC" ]; then
    echo "No encuentro la carpeta $UUID junto a este script." >&2
    exit 1
fi

# Copia de seguridad de lo que la extensión va a tocar
mkdir -p "$BACKUP"
for v in gtk-3.0 gtk-4.0; do
    [ -f "$HOME/.config/$v/gtk.css" ] && cp "$HOME/.config/$v/gtk.css" "$BACKUP/$v-gtk.css"
done
dconf dump /org/gnome/shell/ > "$BACKUP/gnome-shell.ini"
echo "Copia de seguridad en: $BACKUP"

# Las versiones sueltas de las extensiones incluidas chocarían con las de dentro
for ext in dash-to-dock@micxgx.gmail.com blur-my-shell@aunetx \
           rounded-windows@marcosgt.github.io ubuntu-dock@ubuntu.com; do
    gnome-extensions disable "$ext" 2>/dev/null || true
done

mkdir -p "$(dirname "$DEST")"
rm -rf "${DEST:?}"
cp -r "$SRC" "$DEST"

# Activarla (en Wayland GNOME sólo la carga al volver a iniciar sesión)
gnome-extensions enable "$UUID" 2>/dev/null || \
    gsettings set org.gnome.shell enabled-extensions \
      "$(gsettings get org.gnome.shell enabled-extensions | sed "s/]$/, '$UUID']/; s/\[, /[/")"

echo
echo "Instalada. Cierra sesión y vuelve a entrar para que GNOME la cargue."
