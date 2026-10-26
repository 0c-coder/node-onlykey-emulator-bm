/*
 * ctap_bridge: see okplugin_ctap_bridge.h.
 *
 * Storage: 33 bytes of EEPROM after the base firmware's last field (EEpos_webcrypt_policy).
 *   [0]     'D' = off; any other value = on
 *   [1..32] SHA-256 of the allowed rpId; all 0x00 or all 0xFF = none
 */
#include <string.h>
#include "okplugin_ctap_bridge.h"
#include "okcore.h"
#include "okeeprom.h"
#include "sha256.h"

extern "C" {
void okeeprom_eeget_common(uint8_t *ptr, int addr, int len);
void okeeprom_eeset_common(uint8_t *ptr, int addr, int len);
}
extern bool unlocked;
extern bool initialized;
extern bool configmode;
extern void hidprint(const char *chars);

#define CB_POS (EEpos_webcrypt_policy + EElen_webcrypt_policy)
#define CB_OFF 'D'

static int cb_on(void) {
  uint8_t v = 0;
  okeeprom_eeget_common(&v, CB_POS, 1);
  return v != CB_OFF;
}

static int cb_site(uint8_t *hash) {
  okeeprom_eeget_common(hash, CB_POS + 1, 32);
  uint8_t all0 = 0, all1 = 0xFF;
  for (int i = 0; i < 32; i++) { all0 |= hash[i]; all1 &= hash[i]; }
  return all0 != 0 && all1 != 0xFF;
}

int okplugin_ctap_bridge_allows(uint8_t cmd, uint8_t code) {
  if (!cb_on()) return 0;
  if (cmd == OKGETPUBKEY) return code == RESERVED_KEY_DERIVATION || code == DERIVATION_V2_PUBKEY_CODE;
  if (cmd == OKSIGN || cmd == OKDECRYPT) return (code >= 201 && code <= 204) || (code >= 221 && code <= 224);
  return 0;
}

int okplugin_ctap_bridge_site(const uint8_t *appid) {
  uint8_t hash[32];
  if (!appid || !cb_on() || !cb_site(hash)) return 0;
  return memcmp(hash, appid, 32) == 0;
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
  uint8_t hash[32];
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
      if (len == 0 || len > 57) {
        hidprint("Error rpId length");
        return;
      }
      SHA256_CTX ctx;
      sha256_init(&ctx);
      sha256_update(&ctx, buffer + 7, len);
      sha256_final(&ctx, hash);
      okeeprom_eeset_common(hash, CB_POS + 1, 32);
      break;
    }
    case 4:
      memset(hash, 0xFF, sizeof(hash));
      okeeprom_eeset_common(hash, CB_POS + 1, 32);
      break;
    default:
      hidprint("Error unknown ctap_bridge action");
      return;
  }
  hidprint(cb_on() ? (cb_site(hash) ? "ctap_bridge on site set" : "ctap_bridge on site none")
                   : (cb_site(hash) ? "ctap_bridge off site set" : "ctap_bridge off site none"));
}
