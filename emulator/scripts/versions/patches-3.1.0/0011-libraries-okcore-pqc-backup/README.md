# libraries: a key holding a composite PQC PGP key cannot be restored from its own backup

**Patch:** `0011-okcore-back-up-and-restore-a-composite-PQC-PGP-key.patch` (1 commit, `git am`)
**For:** trustcrypto/libraries PR #33, branch `release-3.1.0` @ `37aa531`, after 0008, 0009 and 0010
**Size:** 1 file, +15 / -3: `onlykey/okcore.cpp` (`backup()` and `RESTORE()`).
**Order:** applies on top of 0010 (`git am` clean); it touches nothing the other three do.
**Status:** tested (see section 3). Brad decides whether it is sent.

---

## 1. How it is broken

`onlykey-cli loadpqc <key> PQC1..4` (new in 3.1.0) stores a composite PQC PGP key - its 160-byte seed blob,
`PQC_PGP_BLOB_LEN` - in an RSA slot, with key type 7 (`KEYTYPE_PQC_PGP`). Two things go wrong when that key is
backed up and restored:

**A. The backup copies 896 bytes from a 512-byte buffer.** `backup()` writes each RSA slot as
`0xFE, slot, features` followed by `memcpy(..., rsa_private_key, (type * 128))`. For a PQC PGP slot,
`okcore_flashget_RSA()` reads only the 160-byte blob and leaves `type` = 7, so the copy is 896 bytes from
`rsa_private_key[MAX_RSA_KEY_SIZE = 512]`: 384 bytes past the buffer go into the backup (inside its encryption).
In our Teensy 3.2 link of the RC those bytes are two static mbedTLS RSA contexts (sizes and pointers), two
counters and the first 32 bytes of the transit public key - no private key material - but the layout of another
link may differ.

**B. The restore refuses the record.** `RESTORE()` rebuilds each key record as an `OKSETPRIV` packet and
dispatches on `temp[6] & 0x0F`: 0 for ECC, 1-4 for RSA 1024-4096. Type 7 falls to the `else` branch,
"**Error key configuration backup file format incorrect**", and the restore stops there.

So a key with a PQC PGP key loaded cannot be restored from its own backup.

## 2. The fix

- `backup()`: the length copied (and printed under DEBUG) for an RSA slot is `PQC_PGP_BLOB_LEN` for a type-7 slot,
  `type * 128` otherwise.
- `RESTORE()`: a type-7 record is read as `PQC_PGP_BLOB_LEN` bytes into the same `OKSETPRIV` packet the RSA
  records use and handed to `set_private()`, whose whole-key path (`buffer[0] == 0xBA`) already stores a PQC PGP
  blob exactly as `loadpqc` does.

Nothing changes for an RSA or ECC slot. A backup made by a fixed key and restored onto firmware without this patch
still stops at the PQC record, as such backups do today.

## 3. Tested

Built on `9fceea1` + `37aa531` + 0008 + 0009 + 0010 + 0011 (libraries `b273489`), DEBUG test hex, on developer
keys (Teensy 3.2), the pinned python-onlykey `8d77586`. The proof: a composite key loaded into RSA slot 1, a backup
passphrase set, the typed backup taken, then restored onto the same key - typed (Linux), and as a saved backup
file with `onlykey-cli restore` (Linux and Windows, which cannot capture a typed backup).

| Check | RC as published | With 0011 |
|---|---|---|
| Emulator (DEBUG, AddressSanitizer): restore | "Error key configuration backup file format incorrect" | "Successfully loaded backup" |
| Emulator: the backup's length | 1,243 bytes | 507 bytes - 736 less, exactly 896 - 160 |
| Emulator: AddressSanitizer | READ "0 bytes after global variable 'rsa_private_key' ... of size 512" in `backup()` | no report |
| Hard key, Linux: the typed backup restored | the same refusal (1,243-byte backup) | "Successfully loaded backup" (507-byte backup) |
| Hard key, Linux and Windows: the saved backup restored with `onlykey-cli restore` | | "Successfully loaded backup" on both |

**Everything else, on the 0011 build** (the same key, before and after):

| Check | Windows 11 | Linux |
|---|---|---|
| Kit protocol + security sections (hard key) | 128 passed, 0 failed | 159 passed, 0 failed |
| Upgrade path: a v3.0.4 backup restored with `onlykey-cli restore`, the same SSH key and GnuPG fingerprints, the stored PGP key decrypts and signs | 7/7 | 7/7 |
| `git am` on 0010; test and prod hex build | clean; test 222,596 B (64 B more than without 0011), prod 177,392 B | |

The kit's own backup and restore tests (`10-backup-restore`, `39-wallet-phrase-*`) are in the Linux count; Windows
runs every test that does not need to capture what the key types.

## 4. Not covered here

`backup()` can also encrypt the whole backup to an RSA **backup key** (the slot flagged `0x80`). If a PQC PGP slot
were flagged as the backup key, that path would call `rsa_encrypt()` with it and copy `type * 128` bytes from a
512-byte stack buffer. Whether such a slot can be flagged at all was not checked; this patch does not change it.
