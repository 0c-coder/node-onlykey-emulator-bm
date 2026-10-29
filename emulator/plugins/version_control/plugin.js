'use strict';
/*
 * version_control - OUR RELEASE, ON THE MAINTAINER'S BASE (Brad, 2026-10-28: "i would like to ... bump my development
 * version of the pins i work on, so the version is 1 ahead of the maintainer so we don't collide, and to go back to
 * his version number we don't use the plugin"; "then we enable patches based off that version set in the
 * version_control"; "set our version to his + 0 or 1 or 2, so it would be 3.1.01 or 3.1.02, so his base is followed").
 *
 * version.json beside this file is the whole definition of the release:
 *   {"base": "3.1.0", "build": 1, "patches": ["0012", "0013", "0015", "0016"]}
 * - the firmware reports the base's version with our build appended to its patch number: 3.1.0 + build 1 = v3.1.01
 *   (the maintainer has never used two-digit numbers; node-onlykey-lib src/device/version.js reads a two-digit patch
 *   as his patch digit, then our build), the release keyword (-prod / -test) and the model letter the base's;
 * - the build applies exactly the listed patches (scripts/versions/patches-<base>/, chosen by the stager and by
 *   plugins/edge/tools/build-hardkey.sh) - an experimental one only when listed, a held one never.
 * Left out of a build: the maintainer's release as he published it - his version, no patches.
 * A new release of ours: raise "build" and change the list together, so one version always names one set.
 */
const fs = require('fs');
const path = require('path');

const def = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8'));
const base = /^(\d+)\.(\d+)\.(\d)$/.exec(String(def.base));
if (!base) throw new Error(`version_control: base must be major.minor.patch with a one-digit patch, not ${JSON.stringify(def.base)}`);
if (!Number.isInteger(def.build) || def.build < 1 || def.build > 9) throw new Error(`version_control: build must be 1..9, not ${JSON.stringify(def.build)}`);
if (!Array.isArray(def.patches) || def.patches.some((p) => !/^\d{4}$/.test(p))) throw new Error('version_control: patches must be a list of four-digit patch numbers');
const [, major, minor, patch] = base;
const version = `${major}.${minor}.${patch}${def.build}`;

module.exports = {
  name: 'version_control',
  minBase: '3.1.0',
  notes: `the firmware reports v${version} - base ${def.base}, our build ${def.build}, patches ${def.patches.join(' ') || 'none'} (version.json); left out, the maintainer's release`,
  stateless: true,
  version,
  base: def.base,
  build: def.build,
  patches: def.patches.slice(),
  hooks: [
    {
      file: 'onlykey.h',
      anchor: '#define OKversion "v" OKversionmaj "." OKversionmin "." OKversionpat OKversionkeyword\n',
      insert: 'before',
      text: `/* plugin version_control: v${version}, the base ${def.base} and our build ${def.build} (its version.json) */\n`
        + '#undef OKversionmaj\n#undef OKversionmin\n#undef OKversionpat\n'
        + `#define OKversionmaj "${major}"\n#define OKversionmin "${minor}"\n#define OKversionpat "${patch}${def.build}"\n`,
    },
  ],
};
