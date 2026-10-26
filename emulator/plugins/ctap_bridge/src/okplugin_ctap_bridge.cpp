/*
 * ctap_bridge: see okplugin_ctap_bridge.h.
 *
 * Storage: 50 bytes of EEPROM after the base firmware's last field (EEpos_webcrypt_policy).
 *   [0]      'D' = off; any other value = on
 *   [1]      the allowed rpId's length, 1..48; 0 or 0xFF = none
 *   [2..49]  the allowed rpId (ASCII), compared as its SHA-256 with the request's rpId hash
 */
#include <string.h>
#include "okplugin_ctap_bridge.h"
#include "okcore.h"
#include "okcrypto.h"
#include "okeeprom.h"
#include "sha256.h"

extern "C" {
void okeeprom_eeget_common(uint8_t *ptr, int addr, int len);
void okeeprom_eeset_common(uint8_t *ptr, int addr, int len);
}

#define CB_POS (EEpos_webcrypt_policy + EElen_webcrypt_policy)
#define CB_OFF 'D'
#define CB_SITE_MAX 48

static int cb_on(void) {
  uint8_t v = 0;
  okeeprom_eeget_common(&v, CB_POS, 1);
  return v != CB_OFF;
}

/* the allowed rpId into site (NUL-terminated); its length, 0 when none */
static int cb_site(char *site) {
  uint8_t len = 0;
  okeeprom_eeget_common(&len, CB_POS + 1, 1);
  if (len == 0 || len > CB_SITE_MAX) { site[0] = 0; return 0; }
  okeeprom_eeget_common((uint8_t *)site, CB_POS + 2, len);
  site[len] = 0;
  return len;
}

int okplugin_ctap_bridge_allows(uint8_t cmd, uint8_t code) {
  if (!cb_on()) return 0;
  if (cmd == OKGETPUBKEY) return code == RESERVED_KEY_DERIVATION || code == DERIVATION_V2_PUBKEY_CODE;
  if (cmd == OKSIGN || cmd == OKDECRYPT) return (code >= 201 && code <= 204) || (code >= 221 && code <= 224);
  return 0;
}

int okplugin_ctap_bridge_site(const uint8_t *appid) {
  char site[CB_SITE_MAX + 1];
  int len;
  if (!appid || !cb_on() || !(len = cb_site(site))) return 0;
  uint8_t hash[32];
  SHA256_CTX ctx;
  sha256_init(&ctx);
  sha256_update(&ctx, (const uint8_t *)site, (size_t)len);
  sha256_final(&ctx, hash);
  return memcmp(hash, appid, 32) == 0;
}

void okplugin_ctap_bridge_getpubkey(uint8_t *buffer) {
  buffer[6] = buffer[7];
  memmove(buffer + 7, buffer + 8, 56);
  buffer[63] = 0;
  okcrypto_getpubkey(buffer);
}

void okplugin_ctap_bridge_recv(uint8_t *buffer) {
  if (!(initialized == true && unlocked == true)) {
    hidprint("Error device locked");
    return;
  }
  uint8_t action = buffer[5];
  if (action != 0 && configmode == false) {
    hidprint("Error not in config mode");
    return;
  }
  uint8_t b;
  switch (action) {
    case 0:
      break;
    case 1:
    case 2:
      b = action == 2 ? CB_OFF : 0x01;
      okeeprom_eeset_common(&b, CB_POS, 1);
      break;
    case 3: {
      uint8_t len = buffer[6];
      if (len == 0 || len > CB_SITE_MAX) {
        hidprint("Error rpId length");
        return;
      }
      okeeprom_eeset_common(buffer + 7, CB_POS + 2, len);
      okeeprom_eeset_common(&len, CB_POS + 1, 1);
      break;
    }
    case 4:
      b = 0;
      okeeprom_eeset_common(&b, CB_POS + 1, 1);
      break;
    default:
      hidprint("Error unknown ctap_bridge action");
      return;
  }
  char line[24 + CB_SITE_MAX] = "ctap_bridge ";
  char site[CB_SITE_MAX + 1];
  strcat(line, cb_on() ? "on site " : "off site ");
  strcat(line, cb_site(site) ? site : "none");
  hidprint(line);
}
