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
 * Ported to GNOME 45/46/47/48/49/50 (ExtensionPreferences, Gtk4/Adw).
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DesktopIconsNeoPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('Desktop Icons: Neo'),
            icon_name: 'desktop-icons-neo',
        });
        window.add(page);

        const behaviorGroup = new Adw.PreferencesGroup({
            title: _('Desktop behavior'),
            description: _('To configure Desktop Icons: Neo in detail, right-click a blank space on the desktop and choose “Desktop Icons Settings”.'),
        });
        page.add(behaviorGroup);

        behaviorGroup.add(this._switchRow(
            settings, 'show-home', _('Show personal folder'),
            _('Show the personal folder on the desktop')));
        behaviorGroup.add(this._switchRow(
            settings, 'show-trash', _('Show trash icon'),
            _('Show the trash icon on the desktop')));
        behaviorGroup.add(this._switchRow(
            settings, 'show-volumes', _('Show external drives'),
            _('Show external drives on the desktop')));
        behaviorGroup.add(this._switchRow(
            settings, 'show-network-volumes', _('Show network drives'),
            _('Show mounted network volumes on the desktop')));
        behaviorGroup.add(this._switchRow(
            settings, 'show-drop-place', _('Highlight drop place'),
            _('Highlight the drop place during Drag’n’Drop')));

        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
        });
        page.add(appearanceGroup);

        appearanceGroup.add(this._comboRow(
            settings, 'icon-size', _('Size for the desktop icons'),
            {'tiny': _('Tiny'), 'small': _('Small'), 'standard': _('Standard'), 'large': _('Large')}));
        appearanceGroup.add(this._comboRow(
            settings, 'start-corner', _('New icons alignment'),
            {
                'top-left': _('Top-left corner'),
                'top-right': _('Top-right corner'),
                'bottom-left': _('Bottom-left corner'),
                'bottom-right': _('Bottom-right corner'),
            }));
        appearanceGroup.add(this._comboRow(
            settings, 'icon-shape', _('Icon shape'),
            {
                'conform': _('Conform'),
                'traditional': _('Traditional'),
                'square': _('Square'),
                'capsule': _('Capsule'),
                'rectangular': _('Rectangular'),
            }));
        appearanceGroup.add(this._switchRow(
            settings, 'curved-corners', _('Curve corners (theming)'), null));
        appearanceGroup.add(this._switchRow(
            settings, 'draw-symbols', _('Draw icon symbols'), null));
        appearanceGroup.add(this._switchRow(
            settings, 'add-volumes-opposite',
            _('Add new drives to the opposite side'), null));

        const layoutGroup = new Adw.PreferencesGroup({
            title: _('Icon spacing and margins'),
            description: _('Distance between icons and empty space kept to the screen edges.'),
        });
        page.add(layoutGroup);

        layoutGroup.add(this._spinRow(
            settings, 'spacing-horizontal', _('Horizontal space between icons'),
            _('Gap in pixels between icons, sideways'), 0, 40));
        layoutGroup.add(this._spinRow(
            settings, 'spacing-vertical', _('Vertical space between icons'),
            _('Gap in pixels between icons, vertically'), 0, 40));
        layoutGroup.add(this._spinRow(
            settings, 'margin-top', _('Top screen margin'),
            _('Empty space in pixels above the icons'), 0, 500));
        layoutGroup.add(this._spinRow(
            settings, 'margin-bottom', _('Bottom screen margin'),
            _('Empty space in pixels below the icons'), 0, 500));
        layoutGroup.add(this._spinRow(
            settings, 'margin-left', _('Left screen margin'),
            _('Empty space in pixels left of the icons'), 0, 500));
        layoutGroup.add(this._spinRow(
            settings, 'margin-right', _('Right screen margin'),
            _('Empty space in pixels right of the icons'), 0, 500));

        const arrangeGroup = new Adw.PreferencesGroup({
            title: _('Arrangement'),
        });
        page.add(arrangeGroup);

        arrangeGroup.add(this._switchRow(
            settings, 'keep-arranged', _('Keep icons arranged'),
            _('Always keep icons arranged by the last arranged order')));
        arrangeGroup.add(this._switchRow(
            settings, 'sort-special-folders', _('Sort special folders'),
            _('When arranging icons, also sort Home, Trash and drives')));
    }

    _switchRow(settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({title});
        if (subtitle)
            row.subtitle = subtitle;
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _spinRow(settings, key, title, subtitle, lower, upper) {
        const adjustment = new Gtk.Adjustment({
            lower: lower,
            upper: upper,
            step_increment: 1,
            page_increment: 10,
        });
        const row = new Adw.SpinRow({title, adjustment});
        if (subtitle)
            row.subtitle = subtitle;
        row.value = settings.get_int(key);
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.connect(`changed::${key}`, () => {
            const current = settings.get_int(key);
            if (row.value !== current)
                row.value = current;
        });
        return row;
    }

    _comboRow(settings, key, title, elements) {
        const model = new Gtk.StringList();
        const values = [];
        let selected = 0;
        const current = settings.get_string(key);
        let i = 0;
        for (const [value, label] of Object.entries(elements)) {
            model.append(label);
            values.push(value);
            if (value === current)
                selected = i;
            i++;
        }
        const row = new Adw.ComboRow({title, model, selected});
        row.connect('notify::selected', () => {
            settings.set_string(key, values[row.selected]);
        });
        settings.connect(`changed::${key}`, () => {
            const idx = values.indexOf(settings.get_string(key));
            if (idx !== -1 && idx !== row.selected)
                row.selected = idx;
        });
        return row;
    }
}
