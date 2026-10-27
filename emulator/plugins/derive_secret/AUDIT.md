# derive_secret - audit

**What it is for:** a 32-byte secret the key derives for a host to encrypt with, so stores (the bucket, the password
manager, the guest book) are encrypted on the host under a key the OnlyKey derives - one small request - instead of
being decrypted inside the key with a large answer carried back in chunks (PROPOSAL-derived-keys.md). It adds one
request and changes no existing behaviour.

## Hooks

| File | Where | What |
|---|---|---|
| fido2/ok_extension.cpp | after `#include "onlykey.h"` | the plugin header |
| fido2/solo.cpp | after `case OKSIGN:` | `case (TYPE_INIT \| 0x7C):` - the extension forwards OKDERIVESECRET to the key (solo.cpp does not include onlykey.h, so the wire value) |
| fido2/ok_extension.cpp | before `} else if (cmd == OKSIGN) {` in the packet loop | `OKDERIVESECRET` with opt1 = 128: the base's derive gate (`web_agent_derive_gate`) first - it holds the request - with a press as its floor for touch (`USER_INPUT_PRESS`) and none for touchless; then `okplugin_derive_secret` |

## What it answers

`OKDERIVESECRET` (0x7C, 0xFC on the wire) over the WebAuthn tunnel only (transit-sealed, as every tunnel request
after the connect), slot 128, payload `[mode][SHA-256(label)]`, 33 bytes in one packet:

- **The secret:** `HKDF-SHA256(salt = [0x20 | label hash], IKM = the slot-128 key, info = "onlykey/derive-secret/v1/"
  + "touch/" or "touchless/" + the request's rpId hash)`, 32 bytes, staged with `send_transport_response(…, 1, 0)` -
  sealed by the transit key.
- **Separated** from every other key the firmware derives by its info string: agent keys use slot 132 and
  "onlykey/agent/v2" or SHA-256(K132 | data), web derivations use slot 128 with their own HKDF info, X-Wing uses its
  own label; none of them is ever this output.
- **The two modes** are two unrelated secrets for one label (the mode word is in the info); **each rpId** another (a
  site cannot derive another site's secret).
- **The gate:** the request reaches the plugin only from a site the key already accepts (`webcryptcheck`), only over
  a transit session (unlocked), and only for slot 128 - the slot the base lets through at the default webcrypt level.
  Both go through the base's derive gate, as every derive. Touchless: field 30 decides - the challenge code by default
  (bytes 0/15/31 of SHA-256 of the 33-byte payload, mod 6, mod 3 on a DUO, plus one), a press, or none; so the
  touchless key is protected until the person unprotects it (field 30 = none, in config mode). Touch: the same gate
  with a press as its floor - the code or a press as field 30 says, and a press when it says none; never unpressed.
  The payload carries the mode, so touch and touchless ask different codes. The gate is the one wait the LED, the
  soft key's sheet and key_chain's press record know. Either way the request is held open (`CTAP2_UP_DELAY_MS`).

## Stored

Nothing. `stateless: true` - no EEPROM, no flash, so adding the plugin does not move a soft key to another storage
slot. The slot-128 key is read into `ecc_private_key`, used, and zeroed; the salt and the secret are zeroed after use.

## Not

- No vendor-interface (USB) path: a host with USB speaks the tunnel over CTAPHID.
- No signatures: Edge budgets, commits and identity proofs stay inside the key.
