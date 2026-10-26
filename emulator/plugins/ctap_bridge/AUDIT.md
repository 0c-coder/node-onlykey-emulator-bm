# ctap_bridge - audit

**What it is for:** the web app reaches the key only through WebAuthn (browsers block the OnlyKey from WebHID). The base
firmware forwards four vendor commands over that tunnel - ping, sign, decrypt, the tunnel connect - and, at the default
webcrypt level, sign/decrypt only for slot 128. The bucket identity and the bucket key are agent derivations, so a
browser could not learn which identity the key is. This plugin fills that gap for development, testing and demo. It is
a soft-key plugin, never built into hard keys, and is removed before release (production stays locked to
apps.onlykey.io / apps.crp.to).

## Hooks

| File | Where | What |
|---|---|---|
| okcore.cpp | after `#include "onlykey.h"` | the plugin header |
| okcore.cpp | before the vendor switch's `default:` | `case OKCTAPBRIDGE` (0x7B, 0xFB on the wire) |
| fido2/solo.cpp | after `//case OKGETPUBKEY:` | `case OKGETPUBKEY:` - the extension forwards it to the key |
| fido2/ok_extension.cpp | after `#include "onlykey.h"` | the plugin header |
| fido2/ok_extension.cpp | before the stored-key gate `if (wc_level < 2 && opt1 != RESERVED_KEY_WEB_AGENT_DERIVATION)` | `if (!okplugin_ctap_bridge_allows(cmd, opt1))` - an allowed agent code skips the gate |
| fido2/ok_extension.cpp | before `} else if (cmd == OKSIGN) {` in the packet loop | `OKGETPUBKEY` for an allowed code: the key type from the first payload byte (the tunnel puts its last-packet length in byte 6), the agent key derived with the base's `okcrypto_derive_key` exactly as `okcrypto_getpubkey` does for 132 / 232, and the reply SEALED with the tunnel's transit key (the base sends agent public keys unsealed, right for USB, not for the tunnel) |
| fido2/device.cpp | after `#include "onlykey.h"` | the plugin header |
| fido2/device.cpp | before `if (origin_ok && !(wc_policy & OKWC_DISABLE_EXT))` in `webcryptcheck` | the site set in config mode counts as a trusted origin |

## What it lets through, and only when on

- `OKGETPUBKEY` for codes 132 and 232 (agent public keys, v1 / v2).
- `OKSIGN` / `OKDECRYPT` for codes 201-204 and 221-224 (agent sign / ECDH, v1 / v2) at webcrypt level 1.
- One extra trusted origin: an rpId set in config mode (its SHA-256 compared with the request's rpId hash), readable in the report so an app can show it.
- Nothing else: stored slots, PIN, config, backup and every other command keep the base rules. The requests still go
  through the base's own checks (unlocked, CRYPTO_AUTH, the press for sign/decrypt).

## Stored

50 bytes of EEPROM right after the base firmware's last field (`EEpos_webcrypt_policy + 1`): `[0]` `'D'` = off,
anything else = on (so an unset byte reads ON - development); `[1]` the allowed rpId's length (1..48; 0 or 0xFF = none);
`[2..49]` the rpId itself, ASCII. No key material.

## OKCTAPBRIDGE

**Never over CTAP.** The setting (on/off, the site) can be changed only on the vendor interface, and only in config
mode: `OKCTAPBRIDGE` is a case in okcore.cpp's vendor switch alone, the WebAuthn extension (fido2/solo.cpp) forwards
only ping, sign, decrypt, the tunnel connect and - through this plugin - `OKGETPUBKEY`, and in config mode the key does
not answer CTAP at all. A web page can never enable itself or name its own site.

`buffer[5]`: 0 report ("ctap_bridge on|off site <rpId>|none") while unlocked; 1 on, 2 off, 3 set the site (`buffer[6]`
length, `buffer[7..]` the rpId), 4 clear the site - each only in config mode ("Error not in config mode" otherwise).

## Tests

`tests/kit.test.js`: the report says on while unset; a change outside config mode is refused. The CTAP path is proven
end to end by the web app on the box (the identity read over WebAuthn from Chromium).
