/*
 * v3.1.0 - the release candidate.
 *
 * trustcrypto/libraries PR #33 and trustcrypto/OnlyKey-Firmware PR #183,
 * branch release-3.1.0, one squashed commit each, pinned in
 * node-onlykey-lib/versions at their heads. Not tagged yet: re-pin here and in
 * the library when the PRs move or the tag lands - the cross-check in
 * versions/index.js refuses a script whose `pins` disagree.
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

module.exports = {
  ...workingTree,
  version: 'v3.1.0',
  pins: { libraries: '37aa531', 'OnlyKey-Firmware': '9fceea1' },
  status: 'untried',
  emulator: { linux: 'untried', win32: 'untried' },   /* node-onlykey-emulator's own ladder: boots = matrix stage/build/press/compat PASS on the SIGNED build. Was 'boots' at eb25290 (linux VM x64 and win32, 2026-09-28); reset with the 37aa531 re-pin, 2026-10-21 */
  slot: 'v3.1.0',
  notes: [
    'The release candidate: trustcrypto release-3.1.0 (libraries PR #33,',
    'OnlyKey-Firmware PR #183), pinned at the branch heads 37aa531 / 9fceea1',
    '(libraries re-squashed 2026-10-19). Stages with the working-tree patch',
    'set. Ships DEBUG off. Carries the CTAPHID wipe fix (0c-coder/libraries',
    '#20) since the re-squash.',
  ].join('\n'),
};
