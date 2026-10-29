'use strict';
/*
 * version_control - the version our firmware builds report, one ahead of the maintainer's (Brad, 2026-10-28: "i just
 * don't want to use 3.1.0 in our builds, i would like to use 3.1.1 or be able to bump my development version of the
 * pins i work on, so the version is 1 ahead of the maintainer so we don't collide, and to go back to his version
 * number we don't use the plugin and it goes back to his version easy, just by not including the plugin").
 *
 * The version lives in one file beside this one, VERSION ("3.1.1"): bump it there. The hook redefines the base's
 * three version parts (onlykey.h OKversionmaj / OKversionmin / OKversionpat) right before the line that joins them
 * into OKversion, so everything built from them - the status a host reads ("UNLOCKEDv3.1.1-prodc"), the version shown
 * on the key - says ours. The release keyword (-prod / -test) and the model letter are the base's, untouched.
 * Leave the plugin out and the build reports the maintainer's version, as staged.
 *
 * Hosts compare versions as "at least" (node-onlykey-lib src/device/version.js atLeast): a 3.1.1 has every 3.1.0
 * capability. The firmware's downgrade guard keeps only the major (OnlyKey.ino: EEPROM 1984), so a patch or minor
 * bump never locks a key out of the maintainer's firmware.
 */
const fs = require('fs');
const path = require('path');

const text = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim();
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
if (!m) throw new Error(`version_control: VERSION must be major.minor.patch, not ${JSON.stringify(text)}`);
const [, major, minor, patch] = m;

module.exports = {
  name: 'version_control',
  minBase: '3.1.0',
  notes: `the firmware reports v${text} (VERSION) instead of the base's version; left out, the base's`,
  stateless: true,
  version: text,
  hooks: [
    {
      file: 'onlykey.h',
      anchor: '#define OKversion "v" OKversionmaj "." OKversionmin "." OKversionpat OKversionkeyword\n',
      insert: 'before',
      text: '/* plugin version_control: this build\'s version (its VERSION file) */\n'
        + '#undef OKversionmaj\n#undef OKversionmin\n#undef OKversionpat\n'
        + `#define OKversionmaj "${major}"\n#define OKversionmin "${minor}"\n#define OKversionpat "${patch}"\n`,
    },
  ],
};
