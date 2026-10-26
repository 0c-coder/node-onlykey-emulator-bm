/*
 * ctap_bridge: key features over CTAP (the WebAuthn tunnel) for a browser host.
 *
 * - the agent derivation codes (public key 132/232, sign and decrypt 201-204 / 221-224) pass the
 *   tunnel's stored-key gate, and OKGETPUBKEY is dispatched for them;
 * - one extra allowed site: the SHA-256 of an rpId, set in config mode;
 * - all of it behind one byte, read as ON while unset; turned off or on in config mode.
 *
 * OKCTAPBRIDGE (0xFB on the wire), buffer[5] = action:
 *   0 report: "ctap_bridge on|off site set|none"
 *   1 on, 2 off                                   (config mode)
 *   3 site: buffer[6] = length, buffer[7..] = rpId  (config mode)
 *   4 clear the site                              (config mode)
 */
#ifndef OKPLUGIN_CTAP_BRIDGE_H
#define OKPLUGIN_CTAP_BRIDGE_H

#include <stdint.h>

#define OKCTAPBRIDGE (TYPE_INIT | 0x7B)

void okplugin_ctap_bridge_recv(uint8_t *buffer);
int okplugin_ctap_bridge_allows(uint8_t cmd, uint8_t code);
int okplugin_ctap_bridge_site(const uint8_t *appid);

#endif
