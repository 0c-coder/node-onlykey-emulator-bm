'use strict';
/*
 * derive_secret - a 32-byte secret the key derives for a host to encrypt with (PROPOSAL-derived-keys.md, Brad
 * 2026-10-27: "its own firmware plugin like ctap_bridge and edge"; "2 modes, touchless and touch derive different
 * keys"; "tied to rpid").
 *
 * The bucket used to open by a post-quantum decapsulation inside the key, a 1,289-byte answer carried back in chunks -
 * on Windows each chunk is two WebAuthn round trips. Here the key answers 32 bytes in one request and the host does
 * the encryption. The secret is a hash derivation (HKDF of the slot-128 key), never an ECDH result, so it stays
 * post-quantum safe; the mode and the request's rpId are in the derivation, so a touchless request cannot reach a touch
 * secret and another site the key trusts cannot reach this one's.
 *
 * Carried by the WebAuthn tunnel, which every host can speak (a browser, the desktop app, the phone, the CLI over
 * CTAPHID). opt1 = 128, the slot the firmware already lets through at the default webcrypt level. Touch goes through the
 * firmware's own derive gate (web_agent_derive_gate) with the challenge code as its floor - the key-wide derive setting
 * (field 30) picks code or press; the gate holds the one request open while it waits. Touchless never asks: field 30
 * defaults to the challenge code, so a touchless request that obeyed it would ask on every key left at the default,
 * and touchless is a mode of its own - its secrets are other keys, opened only by touchless requests.
 *
 * It needs no other plugin: it answers for any site the key already accepts (apps.crp.to natively, ctap_bridge's site
 * when that plugin is in). Stateless: no storage of its own, so it does not move a soft key to another slot.
 */
const INC = '#include "plugins/derive_secret/okplugin_derive_secret.h"\n';
module.exports = {
  name: 'derive_secret',
  minBase: '3.1.0',
  notes: 'OKDERIVESECRET 0x7C over the WebAuthn tunnel: HKDF of the slot-128 key, a label hash, the mode (touch/touchless) and the rpId; 32 bytes, sealed',
  stateless: true,
  hooks: [
    { file: 'libraries/fido2/ok_extension.cpp', anchor: '#include "onlykey.h"\n', insert: 'after', text: INC },
    /* solo.cpp forwards the OnlyKey commands to the extension; it does not include onlykey.h, so the wire value */
    { file: 'libraries/fido2/solo.cpp', anchor: '        case OKSIGN:\n', insert: 'after', text: '        case (TYPE_INIT | 0x7C): /* OKDERIVESECRET, plugin derive_secret */\n' },
    {
      /* the transit dispatch: the confirmation first (the gate holds the request), then the derivation */
      file: 'libraries/fido2/ok_extension.cpp',
      anchor: '                    } else if (cmd == OKSIGN) {\n',
      insert: 'before',
      text: '                    } else if (cmd == OKDERIVESECRET && opt1 == RESERVED_KEY_WEB_AGENT_DERIVATION) {\n'
        + '                        large_buffer_offset = 0;\n'
        + '                        outputmode = WEBAUTHN;\n'
        + '                        if (okplugin_derive_secret_mode(recv_buffer) == DS_TOUCH) {\n'
        + '                            int g = web_agent_derive_gate(USER_INPUT_CHALLENGE, recv_buffer + 7, DS_PAYLOAD_LEN);\n'
        + '                            if (g) return g;\n'
        + '                        }\n'
        + '                        okplugin_derive_secret(recv_buffer, _appid);\n',
    },
  ],
};
