'use strict';
/*
 * ctap_bridge - key features over CTAP (the WebAuthn tunnel), for the web app (Brad, 2026-10-26: "create a new
 * firmware plugin that enables the features over ctap ... a toggle in firmware for config mode ... on by default for
 * development ... minimal, light footprint ... the special rpid check for edge in this new plugin too").
 *
 * A browser reaches the key only through WebAuthn, and the base firmware forwards just ping, sign, decrypt and the
 * tunnel connect there - sign/decrypt for slot 128 only at the default webcrypt level. The bucket identity and its
 * bucket key are agent derivations (codes 132/232, 201-204/221-224), so a browser could not read who the key is.
 * This plugin lets those codes through, dispatches OKGETPUBKEY for them, and adds one allowed site; all behind one
 * byte, ON while unset (development), switched in config mode. Testing and demo only; removed before release.
 * See AUDIT.md.
 */
const INC = '#include "plugins/ctap_bridge/okplugin_ctap_bridge.h"\n';
module.exports = {
  name: 'ctap_bridge',
  minBase: '3.1.0',
  notes: 'agent derivation codes + OKGETPUBKEY over the WebAuthn tunnel, one extra allowed site; OKCTAPBRIDGE 0x7B (config mode); on while unset',
  /*
   * its 33 EEPROM bytes read as "on, no site" while unset, and left behind they change nothing: the soft key keeps its
   * storage slot with or without this plugin (firmware-plugins slotPlugins) - adding it must not move the testnet soft
   * key to an empty slot
   */
  stateless: true,
  hooks: [
    { file: 'okcore.cpp', anchor: '#include "onlykey.h"\n', insert: 'after', text: INC },
    {
      /* the vendor switch's own default (okcore.cpp recvmsg) */
      file: 'okcore.cpp',
      anchor: '            default:\n                if (profilemode != NONENCRYPTEDPROFILE && FTFL_FSEC == 0x44 && integrityctr1 == integrityctr2) {\n',
      insert: 'before',
      text: '            case OKCTAPBRIDGE:\n                okplugin_ctap_bridge_recv(recv_buffer);\n                return;\n',
    },
    /* the commands the WebAuthn extension forwards to the key: OKGETPUBKEY joins them */
    { file: 'libraries/fido2/solo.cpp', anchor: '        //case OKGETPUBKEY:\n', insert: 'after', text: '        case OKGETPUBKEY:\n' },
    { file: 'libraries/fido2/ok_extension.cpp', anchor: '#include "onlykey.h"\n', insert: 'after', text: INC },
    {
      /* the stored-key gate: an allowed agent code skips it (the `if` guards the gate's own `if`) */
      file: 'libraries/fido2/ok_extension.cpp',
      anchor: '                if (wc_level < 2 && opt1 != RESERVED_KEY_WEB_AGENT_DERIVATION) {\n',
      insert: 'before',
      text: '                if (!okplugin_ctap_bridge_allows(cmd, opt1))\n',
    },
    {
      /* the packet loop's dispatch: OKGETPUBKEY for an allowed code */
      file: 'libraries/fido2/ok_extension.cpp',
      anchor: '                    } else if (cmd == OKSIGN) {\n',
      insert: 'before',
      text: '                    } else if (cmd == OKGETPUBKEY && okplugin_ctap_bridge_allows(cmd, opt1)) {\n'
        + '                        large_buffer_offset = 0;\n'
        + '                        outputmode = WEBAUTHN;\n'
        + '                        okcrypto_getpubkey(recv_buffer);\n',
    },
    { file: 'libraries/fido2/device.cpp', anchor: '#include "onlykey.h"\n', insert: 'after', text: INC },
    {
      /* the trusted-origin check: the one site set in config mode counts as trusted */
      file: 'libraries/fido2/device.cpp',
      anchor: '    if (origin_ok && !(wc_policy & OKWC_DISABLE_EXT)) {\n',
      insert: 'before',
      text: '    if (!origin_ok && okplugin_ctap_bridge_site(_appid)) origin_ok = 1;\n',
    },
  ],
};
