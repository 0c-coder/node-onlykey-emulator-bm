'use strict';

/**
 * The fixes found testing the 3.1.0 release candidate that its pinned libraries (fe9e293) do NOT carry yet, as
 * staged edits. With them the soft key runs the same firmware as a developer hard key built by
 * plugins/edge/tools/build-hardkey.sh (it `git am`s the same patch files on fe9e293), so a difference between the two
 * is never the base.
 *
 *   0012  okcore: the 20 s user timer stops when a request is decided, so it cannot answer "Timeout" for the next one
 *         (was the emulator plugin fix_usertimeout until 2026-10-26)
 *
 * GONE WITH THE RE-PIN to the maintainer's ok-80e3ba0-fe9e293 (2026-10-26) - upstream carries them, so they are no
 * longer staged; their patches and READMEs stay in this repository's history:
 *   0008  fido2: a repeated poll is served the same chunk again           - in fe9e293 as written
 *   0009  fido2: the version status after the transit key is bounded      - in fe9e293 as written
 *   0010  okcore: the nonce check sums the bytes it read, not always 32    - in fe9e293 as written
 *   0011  okcore: a composite PQC PGP key is backed up as its 160-byte blob - in fe9e293 in the maintainer's own form
 *
 * GENERATED below `module.exports` from the patch files in patches-3.1.0/ beside this file (each with its README -
 * the patch as the maintainer gets it) by gen-fixes.js: change or add the patch, then `node gen-fixes.js 3.1.0`
 * (`--check`: does this still match; `--verify <libraries checkout>`: every find string occurs once at fe9e293).
 *
 * Applied by v3.1.0.js unless OKEMU_RC_FIXES=0 (the RC exactly as published, for the compatibility matrix).
 * build.json records which, as `fixes`.
 */
module.exports = {
  names: ["0012"],
  patches: [
    /* 0012-okcore-stop-the-20-s-user-timer-when-a-request-is-decided.patch */
    {
      file: "libraries/onlykey/okcore.cpp",
      edits: [
        ["// Runs the operation staged by done_process_packets(). CRYPTO_AUTH must\n// already be 4.\nvoid okcore_run_pending_op() {\n    derived_key_challenge_mode = 0;\n    stored_key_challenge_mode = 0;\n    if (packet_buffer_details[0] == OKSIGN) {\n",
         "// Runs the operation staged by done_process_packets(). CRYPTO_AUTH must\n// already be 4.\nvoid okcore_run_pending_op() {\n    cancelfadeoffafter20(); /* the request is decided: its 20 s wait for the user is over */\n    derived_key_challenge_mode = 0;\n    stored_key_challenge_mode = 0;\n    if (packet_buffer_details[0] == OKSIGN) {\n"],
      ],
    },
  ],
};
