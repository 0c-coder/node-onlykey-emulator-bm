/*
 * derive_secret: a 32-byte secret derived by the key for a host to encrypt with.
 *
 * OKDERIVESECRET (0xFC on the wire) over the WebAuthn tunnel, slot (opt1) 128. Payload:
 *   [0]      mode: DS_TOUCHLESS (answered while unlocked) or DS_TOUCH (the press or the challenge code)
 *   [1..32]  the label's SHA-256
 * exactly DS_PAYLOAD_LEN bytes in one final packet; any other length is refused ("Error derive_secret request")
 * before the confirmation. Answer, sealed by the transit key: 32 bytes,
 *   HKDF-SHA256(salt = [0x20 | label hash], IKM = the slot-128 key,
 *               info = "onlykey/derive-secret/v1/" + ("touch/" | "touchless/") + the request's rpId hash)
 * The two modes and every rpId give unrelated secrets for one label. The confirmation runs before the derivation:
 * the code is bytes 0/15/31 of SHA-256(the 33-byte payload), mod 6 (mod 3 on a DUO) plus one.
 */
#ifndef OKPLUGIN_DERIVE_SECRET_H
#define OKPLUGIN_DERIVE_SECRET_H

#include <stdint.h>

#define OKDERIVESECRET (TYPE_INIT | 0x7C)
#define DS_TOUCHLESS 1
#define DS_TOUCH 2
#define DS_PAYLOAD_LEN 33

/* the payload's mode (buffer[7]), or -1 when it is neither */
int okplugin_derive_secret_mode(const uint8_t *buffer);
/* derive and stage the sealed answer; buffer is the dispatched packet, appid the request's rpId hash */
void okplugin_derive_secret(const uint8_t *buffer, const uint8_t *appid);

#endif
