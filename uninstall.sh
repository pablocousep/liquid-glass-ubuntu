#!/usr/bin/env bash
# Desinstala Liquid Glass y restaura la última copia de seguridad de install.sh.
set -euo pipefail

UUID="liquid-glass-ubuntu@pablocousep"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

gnome-extensions disable "$UUID" 2>/dev/null || true
rm -rf "${DEST:?}"

LAST="$(ls -d "$HOME"/.local/share/liquid-glass/backup-* 2>/dev/null | sort | tail -1 || true)"
if [ -n "$LAST" ]; then
    for v in gtk-3.0 gtk-4.0; do
        if [ -f "$LAST/$v-gtk.css" ]; then
            cp "$LAST/$v-gtk.css" "$HOME/.config/$v/gtk.css"
        else
            rm -f "$HOME/.config/$v/gtk.css"
        fi
    done
    dconf load /org/gnome/shell/ < "$LAST/gnome-shell.ini"
    echo "Restaurada la copia: $LAST"
fi
rm -f "$HOME/.local/share/liquid-glass/setup-version"

echo "Desinstalada. Cierra sesión y vuelve a entrar."
