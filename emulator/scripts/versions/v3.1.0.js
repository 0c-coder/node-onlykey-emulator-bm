/*
 * v3.1.0 - the release candidate.
 *
 * RE-PINNED 2026-10-26 to the maintainer's pins ok-80e3ba0-fe9e293:
 * OnlyKey-Firmware 80e3ba0 (release-3.1.0, PR #183, merged to master - the same
 * files as 9fceea1) and libraries fe9e293 (master: release-3.1.0, PR #33,
 * merged, then "Security fixes from the 3.1.0 review"). Our RC fixes 0008-0010
 * are in fe9e293 as written and 0011 in the maintainer's own form, so they are
 * no longer staged (fixes-3.1.0.js). Not tagged yet: re-pin here and in the
 * library when the tag lands - the cross-check in versions/index.js refuses a
 * script whose `pins` disagree.
 *
 * RE-PINNED 2026-10-21: libraries eb25290 (the 2026-09-28 squash) -> 37aa531
 * (release-3.1.0 re-squashed 2026-10-19; the library's table already pinned
 * it, so the cross-check refused this script). The re-squash adds 6 files,
 * +47/-13, among them the CTAPHID wipe fix below and the large-response
 * buffer's reset. OnlyKey-Firmware stays 9fceea1.
 *
 * WHAT IT IS, measured against the working tree it replaced:
 *
 *   - Re-indented and re-spaced throughout. Two stage patches stopped matching
 *     on whitespace alone (touch_sense_loop()'s press hand-over, okcrypto.cpp's
 *     stack-address print); both now list the 3.1.0 spelling (stage.js,
 *     d3eb14a). With that the working-tree patch set applies unchanged, which
 *     is why this spreads working-tree - measured: 9 patches, no warnings.
 *   - Ships with the DEBUG gate OFF (the working tree had it on). A pinned
 *     release stages signed by default here anyway; the test kit, which drives
 *     presses through the DEBUG console, builds it with OKEMU_DEBUG=1.
 *   - CARRIES the CTAPHID wipe fix (0c-coder/libraries #20) since the 37aa531
 *     re-squash: ctap_buffer is no longer wiped while a CTAPHID message is
 *     still arriving. At eb25290 it did not, and kit
 *     01-protocol/32-ctaphid-wipe-timer failed on it (143/1/6).
 *
 * Emulator rungs reset to 'untried' with the re-pin: 'boots' was watched at
 * eb25290, not at 37aa531. The matrix builds the SIGNED release and runs press
 * + compat on it to climb them again.
 */
'use strict';

const workingTree = require('./working-tree');
const rcFixes = require('./fixes-3.1.0');

/*
 * THE PATCHES ARE THE RELEASE'S: OURS IS NAMED BY THE version_control PLUGIN (Brad, 2026-10-28: "enable patches based
 * off that version set in the version_control"; "to go back to his version number we don't use the plugin"). A build
 * whose plugins include version_control applies exactly the patches its version.json lists (fixes-3.1.0.js byName) and
 * reports that version (3.1.01, ...); a build without it is the maintainer's 3.1.0 as published - no patches. A listed
 * patch that is not here (held, or a typo) stops the build: the list is the release's whole definition.
 * build.json records them as `fixes`, so a build says what it carries.
 */
function versionControl() {
  const plugins = require('node-onlykey-lib/cli/firmware-plugins').selected();
  if (!plugins.includes('version_control')) return null;
  const dir = process.env.OKEMU_PLUGINS_DIR ? require('path').resolve(process.env.OKEMU_PLUGINS_DIR) : require('path').join(__dirname, '..', '..', 'plugins');
  return require(require('path').join(dir, 'version_control', 'plugin.js'));
}
const ours = versionControl();
if (ours && ours.base !== '3.1.0') throw new Error(`version_control names base ${ours.base}; this stages 3.1.0`);
const chosen = ours ? ours.patches : [];
for (const n of chosen) {
  if (!rcFixes.byName[n]) {
    throw new Error(`version_control lists patch ${n}, which patches-3.1.0/ does not stage${rcFixes.held.includes(n) ? ' (it is held)' : ''}`);
  }
}

module.exports = {
  ...workingTree,
  patches: chosen.flatMap((n) => rcFixes.byName[n]),
  fixes: chosen,
  version: 'v3.1.0',
  pins: { libraries: 'fe9e293', 'OnlyKey-Firmware': '80e3ba0' },
  status: 'untried',
  emulator: { linux: 'boots', win32: 'boots' },   /* node-onlykey-emulator's own ladder: boots = matrix stage/build/press/compat PASS on the SIGNED build. At 37aa531: linux (ZBOX x64) and win32, 2026-10-21; re-pinned to fe9e293 2026-10-26, to be re-proved there. (Was 'boots' on both at eb25290, 2026-09-28.) */
  slot: 'v3.1.0',
  notes: [
    'The maintainer\'s pins ok-80e3ba0-fe9e293 (2026-10-26): release-3.1.0',
    '(libraries PR #33, OnlyKey-Firmware PR #183) merged to master, plus the',
    '3.1.0 security review fixes (libraries fe9e293). Stages with the',
    'working-tree patch set and the RC fixes still open upstream',
    '(fixes-3.1.0.js). Ships DEBUG off.',
  ].join('\n'),
};
