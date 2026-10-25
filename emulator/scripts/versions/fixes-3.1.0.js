'use strict';

/**
 * The fixes found testing the 3.1.0 release candidate, as staged edits on its pinned libraries
 * (37aa531). With them the soft key runs the same firmware as a developer hard key built by
 * plugins/edge/tools/build-hardkey.sh (libraries b273489 = 37aa531 + these), so a difference
 * between the two is never the base.
 *
 *   0008  fido2: Windows sends every WebAuthn request twice - a repeated poll is served the same
 *         chunk again, and a repeated data packet is never acted on (2 commits)
 *   0009  fido2: the version status copied after the transit key is bounded by ecc_public_key
 *   0010  okcore: the nonce check sums the bytes it read, not always 32
 *   0011  okcore: a composite PQC PGP key is backed up and restored as its 160-byte blob
 *
 * GENERATED from the patch files in patches-3.1.0/ beside this file (0008..0011, each with its README - the
 * patches as the maintainer has them) and PROVEN when generated:
 * applied in this order to the files at 37aa531 they give exactly the files at b273489, and
 * every find string occurs once. Regenerate rather than edit: a hand change here stops being
 * the patch the maintainer has.
 *
 * Applied by v3.1.0.js unless OKEMU_RC_FIXES=0 (the RC exactly as published, for the
 * compatibility matrix). build.json records which, as `fixes`.
 */
module.exports = {
  names: ['0008', '0009', '0010', '0011'],
  patches: [
    /* 0008-fido2-windows-duplicate-requests.patch: fido2: serve the same chunk again for a repeated poll */
    {
      file: "libraries/fido2/ok_extension.cpp",
      edits: [
        ["extern int packet_buffer_offset;\nextern uint8_t packet_buffer_details[5];\n\n// Confirmation for slot-128 shared-secret derives, set by field 30:\n// 0 = challenge code, 1 = button press, 2 = none. The challenge code is\n// bytes 0/15/31 of SHA-256(label hash | input public key), mod 6 (mod 3 on\n",
         "extern int packet_buffer_offset;\nextern uint8_t packet_buffer_details[5];\n\n/* Set for a poll whose transit frame repeats the previous frame's counter. The\n * stored response then serves the chunk it served last instead of the next\n * one, so the copy the host keeps holds the chunk the first copy consumed. */\nstatic uint8_t repeated_poll = 0;\n\n// Confirmation for slot-128 shared-secret derives, set by field 30:\n// 0 = challenge code, 1 = button press, 2 = none. The challenge code is\n// bytes 0/15/31 of SHA-256(label hash | input public key), mod 6 (mod 3 on\n"],
        ["                    return ret;\n                }\n                handle_len = ptlen;\n            }\n#ifdef DEBUG\n            Serial.println(\"Decrypted client handle\");\n",
         "                    return ret;\n                }\n                handle_len = ptlen;\n                repeated_poll = (cmd == OKPING) && okcrypto_transit_repeated();\n            }\n#ifdef DEBUG\n            Serial.println(\"Decrypted client handle\");\n"],
        ["\nint16_t send_stored_response(uint8_t *output, uint8_t opt3) {\n    int16_t ret = 0;\n    if (profilemode != NONENCRYPTEDPROFILE) {\n#ifdef DEBUG\n        Serial.print(\"Sending data on OnlyKey via Webauthn \");\n",
         "\nint16_t send_stored_response(uint8_t *output, uint8_t opt3) {\n    int16_t ret = 0;\n    uint8_t repeat = repeated_poll;\n    repeated_poll = 0;\n    if (profilemode != NONENCRYPTEDPROFILE) {\n#ifdef DEBUG\n        Serial.print(\"Sending data on OnlyKey via Webauthn \");\n"],
        ["            ret = CTAP2_ERR_OPERATION_PENDING;\n        } else if (large_resp_buffer_offset) {\n            int delivered = large_resp_buffer_cursor >= large_resp_buffer_offset;\n            int is_duplicate = delivered || (opt3 && large_resp_buffer_last_opt3 && opt3 <= large_resp_buffer_last_opt3);\n            int chunk_start = large_resp_buffer_cursor;\n            if (is_duplicate && large_resp_buffer_cursor)\n                chunk_start = (large_resp_buffer_cursor - 1) / MAX_LARGE_RESP_CHUNK * MAX_LARGE_RESP_CHUNK;\n",
         "            ret = CTAP2_ERR_OPERATION_PENDING;\n        } else if (large_resp_buffer_offset) {\n            int delivered = large_resp_buffer_cursor >= large_resp_buffer_offset;\n            int is_duplicate = delivered || repeat || (opt3 && large_resp_buffer_last_opt3 && opt3 <= large_resp_buffer_last_opt3);\n            int chunk_start = large_resp_buffer_cursor;\n            if (is_duplicate && large_resp_buffer_cursor)\n                chunk_start = (large_resp_buffer_cursor - 1) / MAX_LARGE_RESP_CHUNK * MAX_LARGE_RESP_CHUNK;\n"],
      ],
    },
    /* 0008-fido2-windows-duplicate-requests.patch: fido2: serve the same chunk again for a repeated poll */
    {
      file: "libraries/onlykey/okcrypto.cpp",
      edits: [
        [" * the tag check. */\nstatic uint32_t transit_ctr_out = 0; /* device -> host */\n\nvoid okcrypto_transit_reset(void) {\n    transit_ctr_out = 0;\n}\n\nstatic void okcrypto_transit_iv(uint8_t *iv, uint8_t dir, uint32_t ctr) {\n",
         " * the tag check. */\nstatic uint32_t transit_ctr_out = 0; /* device -> host */\n\n/* The counter of the last inbound frame opened, and whether the latest open\n * carried the same counter as the one before it. */\nstatic uint32_t transit_ctr_in_last = 0;\nstatic uint8_t transit_ctr_in_seen = 0;\nstatic uint8_t transit_ctr_in_repeat = 0;\n\nvoid okcrypto_transit_reset(void) {\n    transit_ctr_out = 0;\n    transit_ctr_in_last = 0;\n    transit_ctr_in_seen = 0;\n    transit_ctr_in_repeat = 0;\n}\n\n/* 1 when the frame just opened repeated the previous frame's counter: the host\n * sent the same request again rather than a new one. The host seals every\n * message with the next counter, so a repeat is a re-send of a request already\n * answered (Windows sends every FIDO2 request twice). */\nint okcrypto_transit_repeated(void) {\n    return transit_ctr_in_repeat;\n}\n\nstatic void okcrypto_transit_iv(uint8_t *iv, uint8_t dir, uint32_t ctr) {\n"],
        ["    uint32_t ctr;\n    GCM<AES256> gcm;\n    int ptlen = len - OKCRYPTO_TRANSIT_OVERHEAD;\n    if (ptlen < 0) {\n        memset(frame, 0, len > 0 ? len : 0);\n        return -1;\n",
         "    uint32_t ctr;\n    GCM<AES256> gcm;\n    int ptlen = len - OKCRYPTO_TRANSIT_OVERHEAD;\n    transit_ctr_in_repeat = 0;\n    if (ptlen < 0) {\n        memset(frame, 0, len > 0 ? len : 0);\n        return -1;\n"],
        ["        memset(frame, 0, len);\n        return -1;\n    }\n    memmove(frame, ct, ptlen);\n    memset(frame + ptlen, 0, len - ptlen);\n#ifdef DEBUG\n    Serial.print(\"transit open ctr=\");\n    Serial.print(ctr);\n    Serial.print(\" len=\");\n    Serial.println(ptlen);\n#endif\n",
         "        memset(frame, 0, len);\n        return -1;\n    }\n    transit_ctr_in_repeat = transit_ctr_in_seen && ctr == transit_ctr_in_last;\n    transit_ctr_in_last = ctr;\n    transit_ctr_in_seen = 1;\n    memmove(frame, ct, ptlen);\n    memset(frame + ptlen, 0, len - ptlen);\n#ifdef DEBUG\n    Serial.print(\"transit open ctr=\");\n    Serial.print(ctr);\n    Serial.print(transit_ctr_in_repeat ? \" repeat\" : \"\");\n    Serial.print(\" len=\");\n    Serial.println(ptlen);\n#endif\n"],
      ],
    },
    /* 0008-fido2-windows-duplicate-requests.patch: fido2: serve the same chunk again for a repeated poll */
    {
      file: "libraries/onlykey/okcrypto.h",
      edits: [
        ["extern void okcrypto_transit_reset(void);\nextern int okcrypto_transit_seal(uint8_t *frame, int len);\nextern int okcrypto_transit_open(uint8_t *frame, int len);\nextern void okcrypto_getpubkey(uint8_t *buffer);\nextern void okcrypto_generate_random_key(uint8_t *buffer);\nextern void okcrypto_geteccpubkey(uint8_t *buffer);\n",
         "extern void okcrypto_transit_reset(void);\nextern int okcrypto_transit_seal(uint8_t *frame, int len);\nextern int okcrypto_transit_open(uint8_t *frame, int len);\nextern int okcrypto_transit_repeated(void);\nextern void okcrypto_getpubkey(uint8_t *buffer);\nextern void okcrypto_generate_random_key(uint8_t *buffer);\nextern void okcrypto_geteccpubkey(uint8_t *buffer);\n"],
      ],
    },
    /* 0008-fido2-windows-duplicate-requests.patch: fido2: never act on a repeated data packet */
    {
      file: "libraries/fido2/ok_extension.cpp",
      edits: [
        ["                }\n                handle_len = ptlen;\n                repeated_poll = (cmd == OKPING) && okcrypto_transit_repeated();\n            }\n#ifdef DEBUG\n            Serial.println(\"Decrypted client handle\");\n",
         "                }\n                handle_len = ptlen;\n                repeated_poll = (cmd == OKPING) && okcrypto_transit_repeated();\n                if (cmd != OKPING && okcrypto_transit_repeated()) {\n                    // The same data packet again. Acting on it would start a new\n                    // message from this one packet, and when it is the final packet of\n                    // a message already confirmed, its result would replace the real\n                    // one. Answered as the opt3 duplicate check below answers.\n#ifdef DEBUG\n                    Serial.println(\"Repeated data packet ignored\");\n#endif\n                    return 0;\n                }\n            }\n#ifdef DEBUG\n            Serial.println(\"Decrypted client handle\");\n"],
      ],
    },
    /* 0009-fido2-bound-the-version-status-copied-after-the-transit-key.patch: fido2: bound the version status copied after the transit key */
    {
      file: "libraries/fido2/ok_extension.cpp",
      edits: [
        ["            Serial.println(\"OnlyKey public = \");\n            byteprint(ecc_public_key, 32);\n#endif\n            memcpy(ecc_public_key + 32, HW_MODEL(UNLOCKED), sizeof(UNLOCKED) + 1);\n            // Response goes out via WEBAUTHN\n            outputmode = WEBAUTHN;\n            memcpy(temp, ecc_public_key, sizeof(ecc_public_key)); //Store OnlyKey public NACL transit key (includes OnlyKey version info)\n",
         "            Serial.println(\"OnlyKey public = \");\n            byteprint(ecc_public_key, 32);\n#endif\n            {\n                // The status follows the key, bounded by the room left in ecc_public_key:\n                // a version name longer than that is cut here, as the copy into temp\n                // below cuts it.\n                const char *status = HW_MODEL(UNLOCKED);\n                size_t len = strlen(status) + 1;\n                const size_t room = sizeof(ecc_public_key) - 32;\n                if (len > room) len = room;\n                memcpy(ecc_public_key + 32, status, len);\n            }\n            // Response goes out via WEBAUTHN\n            outputmode = WEBAUTHN;\n            memcpy(temp, ecc_public_key, sizeof(ecc_public_key)); //Store OnlyKey public NACL transit key (includes OnlyKey version info)\n"],
      ],
    },
    /* 0010-okcore-the-nonce-check-sums-the-bytes-it-read-not-always-32.patch: okcore: the nonce check sums the bytes it read, not always 32 */
    {
      file: "libraries/onlykey/okcore.cpp",
      edits: [
        ["    Serial.println(\"Reading nonce\");\n#endif\n    okcore_flashget_common(ptr, (unsigned long *)adr, size);\n    for (int i = 0; i < 32; i++) {\n        set = *(ptr + i) + set;\n    }\n#ifdef DEBUG\n    Serial.println(set);\n#endif\n    if (set == 8160) { //0xFF * 32\n#ifdef DEBUG\n        Serial.println(\"There is no Nonce hash set\");\n#endif\n",
         "    Serial.println(\"Reading nonce\");\n#endif\n    okcore_flashget_common(ptr, (unsigned long *)adr, size);\n    // Only the size bytes read into ptr: callers pass 12-byte buffers as well as 32-byte ones.\n    for (int i = 0; i < size; i++) {\n        set = *(ptr + i) + set;\n    }\n#ifdef DEBUG\n    Serial.println(set);\n#endif\n    if (set == 0xFF * size) { // every byte read is 0xFF: the sector was never written\n#ifdef DEBUG\n        Serial.println(\"There is no Nonce hash set\");\n#endif\n"],
      ],
    },
    /* 0011-okcore-back-up-and-restore-a-composite-PQC-PGP-key.patch: okcore: back up and restore a composite PQC PGP key as its */
    {
      file: "libraries/onlykey/okcore.cpp",
      edits: [
        ["        if (slot == backupslot)\n            features = features + 0x80;\n        if (features != 0x00) {\n            large_temp[large_buffer_offset] = 0xFE; //delimiter\n            large_temp[large_buffer_offset + 1] = slot;\n            large_temp[large_buffer_offset + 2] = features;\n            memcpy(large_temp + large_buffer_offset + 3, rsa_private_key, (type * 128));\n            large_buffer_offset = large_buffer_offset + (type * 128) + 3;\n#ifdef DEBUG\n            byteprint(rsa_private_key, (type * 128));\n#endif\n        } else {\n#ifdef DEBUG\n",
         "        if (slot == backupslot)\n            features = features + 0x80;\n        if (features != 0x00) {\n            /* An RSA key is type * 128 bytes; a composite PQC PGP key is its PQC_PGP_BLOB_LEN seed blob,\n             * which is all okcore_flashget_RSA() reads into rsa_private_key for that type. */\n            int keylen = (type == KEYTYPE_PQC_PGP) ? PQC_PGP_BLOB_LEN : (type * 128);\n            large_temp[large_buffer_offset] = 0xFE; //delimiter\n            large_temp[large_buffer_offset + 1] = slot;\n            large_temp[large_buffer_offset + 2] = features;\n            memcpy(large_temp + large_buffer_offset + 3, rsa_private_key, keylen);\n            large_buffer_offset = large_buffer_offset + keylen + 3;\n#ifdef DEBUG\n            byteprint(rsa_private_key, keylen);\n#endif\n        } else {\n#ifdef DEBUG\n"],
        ["                        set_private(temp);\n                        ptr = ptr + 512;\n                        offset = offset - 515;\n                    } else {\n#ifdef DEBUG\n                        Serial.print(\"Error key configuration backup file format incorrect\");\n",
         "                        set_private(temp);\n                        ptr = ptr + 512;\n                        offset = offset - 515;\n                    } else if ((temp[6] & 0x0F) == KEYTYPE_PQC_PGP) { //Expect PQC_PGP_BLOB_LEN Bytes\n#ifdef DEBUG\n                        Serial.print(\"Restore composite PQC PGP key\");\n#endif\n                        ptr++;\n                        memcpy(temp + 7, ptr, PQC_PGP_BLOB_LEN);\n                        set_private(temp);\n                        ptr = ptr + PQC_PGP_BLOB_LEN;\n                        offset = offset - (PQC_PGP_BLOB_LEN + 3);\n                    } else {\n#ifdef DEBUG\n                        Serial.print(\"Error key configuration backup file format incorrect\");\n"],
      ],
    },
  ],
};
