/*
 * derive_secret: see okplugin_derive_secret.h.
 */
#include <string.h>
#include "onlykey.h"
#include "okplugin_derive_secret.h"

extern uint8_t ecc_private_key[MAX_ECC_KEY_SIZE];
void okcrypto_hkdf_info(const void *salt, const void *inputKey, void *outputKey, const size_t L,
    const uint8_t *info, size_t info_len);

int okplugin_derive_secret_mode(const uint8_t *buffer) {
  if (buffer[7] == DS_TOUCHLESS || buffer[7] == DS_TOUCH) return buffer[7];
  return -1;
}

void okplugin_derive_secret(const uint8_t *buffer, const uint8_t *appid) {
  int mode = okplugin_derive_secret_mode(buffer);
#ifdef DEBUG
  {
    /* DEBUG: the mode, the payload's first byte, and whether the rpId hash is there (0xDD) */
    uint8_t seen[3] = {(uint8_t)mode, buffer[7], (uint8_t)(appid ? 0xDD : 0)};
    byteprint(seen, 3);
  }
#endif
  if (mode < 0 || !appid) {
    hidprint("Error derive_secret request");
    return;
  }
  static const char PREFIX[] = "onlykey/derive-secret/v1/";
  const char *word = mode == DS_TOUCH ? "touch/" : "touchless/";
  const size_t prefix_len = sizeof(PREFIX) - 1;
  const size_t word_len = strlen(word);
  uint8_t info[sizeof(PREFIX) - 1 + 10 + 32];
  memcpy(info, PREFIX, prefix_len);
  memcpy(info + prefix_len, word, word_len);
  memcpy(info + prefix_len + word_len, appid, 32);

  uint8_t salt[33];
  salt[0] = 0x20;
  memcpy(salt + 1, buffer + 8, 32);

  uint8_t secret[32];
  okcore_flashget_ECC(RESERVED_KEY_WEB_AGENT_DERIVATION);
  okcrypto_hkdf_info(salt, ecc_private_key, secret, 32, info, prefix_len + word_len + 32);
  memset(ecc_private_key, 0, sizeof(ecc_private_key));
  memset(salt, 0, sizeof(salt));

  send_transport_response(secret, 32, 1, 0);
  memset(secret, 0, sizeof(secret));
}
