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
 * CTAPHID). opt1 = 128, the slot the firmware already lets through at the default webcrypt level. The two modes are
 * the plugin's own, not a key setting (Brad, 2026-10-27: "1 key can just be pulled while it's unlocked, and another
 * protected by a press, not a config mode"; "2 different keys, same settings, and a flag sent over the request to ask
 * for a press"; "the no-touch key still uses mode 30, so it still MAY require a press if the config setting tells it"):
 * touchless goes through the base's derive gate as every derive does - field 30 decides (code, press or none); touch
 * always asks for a press (derive_secret_touch, built from the gate's own calls), whatever field 30 says. Either holds
 * the one request open while it waits.
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
      /*
       * touch's confirmation, built from the base derive gate's own calls but fixed: a press, whatever the key-wide
       * derive setting (field 30) says (Brad, 2026-10-27: "2 different keys, same settings, and a flag sent over the
       * request to ask for a press"). The flag is the mode byte: it asks for the press AND it is in the derivation, so
       * the touch secret is another key that only a pressed request ever reaches.
       */
      file: 'libraries/fido2/ok_extension.cpp',
      anchor: 'uint8_t transit_key[32];\n',
      insert: 'before',
      text: 'static int derive_secret_touch(void) {\n'
        + '    device_set_status(CTAPHID_STATUS_UPNEEDED);\n'
        + '    int but = ctap_user_presence_test(CTAP2_UP_DELAY_MS);\n'
        + '    if (but == -2) { pending_operation = 0; return CTAP2_ERR_OPERATION_DENIED; }\n'
        + '    if (but > 1) return CTAP2_ERR_PROCESSING;\n'
        + '    if (but < 0) return CTAP2_ERR_KEEPALIVE_CANCEL;\n'
        + '    if (but == 0) { pending_operation = 0; return CTAP2_ERR_ACTION_TIMEOUT; }\n'
        + '    return 0;\n'
        + '}\n',
    },
    {
      /* the transit dispatch: the confirmation first (it holds the request), then the derivation */
      file: 'libraries/fido2/ok_extension.cpp',
      anchor: '                    } else if (cmd == OKSIGN) {\n',
      insert: 'before',
      text: '                    } else if (cmd == OKDERIVESECRET && opt1 == RESERVED_KEY_WEB_AGENT_DERIVATION) {\n'
        + '                        large_buffer_offset = 0;\n'
        + '                        outputmode = WEBAUTHN;\n'
        + '                        {\n'
        + '                            /* the request, copied before the wait: while a gate waits it serves USB, and recv_buffer is reused */\n'
        + '                            uint8_t ds_req[7 + DS_PAYLOAD_LEN];\n'
        + '                            memcpy(ds_req, recv_buffer, sizeof(ds_req));\n'
        + '                            int g = okplugin_derive_secret_mode(ds_req) == DS_TOUCH ? derive_secret_touch()\n'
        + '                                : web_agent_derive_gate(USER_INPUT_NONE, ds_req + 7, DS_PAYLOAD_LEN);\n'
        + '                            if (g) { memset(ds_req, 0, sizeof(ds_req)); return g; }\n'
        + '                            /* the rpId hash: U2F hands it in; on CTAP2 _appid is NULL (extend_fido2), and getAssertion holds it */\n'
        + '                            extern struct _getAssertionState getAssertionState;\n'
        + '                            okplugin_derive_secret(ds_req, _appid ? _appid : getAssertionState.buf.authData.rpIdHash);\n'
        + '                            memset(ds_req, 0, sizeof(ds_req));\n'
        + '                        }\n',
    },
  ],
};
