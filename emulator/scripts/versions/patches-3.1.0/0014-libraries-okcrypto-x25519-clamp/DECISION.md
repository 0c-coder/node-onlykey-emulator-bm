# 0014 - X25519 without RFC 7748 clamping: the facts for a decision

**For:** Tim (trustcrypto), and the Claude session helping him decide.
**Against:** trustcrypto/libraries `fe9e293` (the 3.1.0 pins ok-80e3ba0-fe9e293). Every line number below is at that
commit; `git show fe9e293:<file>` shows it.
**What is asked:** a decision, not a merge. The fix is two small edits, but it **changes keys that already exist**. Whether
to take it, when, and how to migrate are the maintainer's call. This document lays out what is known, what is measured,
what is only read from the source, and the options - it does not argue for one.

---

## 1. The issue

X25519 as RFC 7748 defines it always "clamps" the 32-byte private scalar before multiplying: clear the low 3 bits, clear
bit 255, set bit 254. The firmware's classic Curve25519 path passes the stored scalar straight to `Curve25519::eval()`,
which does not clamp (its caller is expected to).

| `fe9e293` | function | what it does |
|---|---|---|
| `onlykey/okcrypto.cpp:2412-2429` | `okcrypto_compute_pubkey()`, `KEYTYPE_CURVE25519` | `swap_buffer(0, 31, ecc_private_key); Curve25519::eval(ecc_public_key, ecc_private_key, 0);` - the public key, unclamped |
| `onlykey/okcrypto.cpp:1124`, `:1158` | `okcrypto_shared_secret()`, `case KEYTYPE_CURVE25519` | `Curve25519::eval(secret, ecc_private_key, pub);` - ECDH, unclamped |

Two places in the same tree already clamp:

- `Crypto/Curve25519.cpp:252`, `Curve25519::dh1()`: `f[0] &= 0xF8; ...` before `eval()`.
- `onlykey/okpqc.cpp:61`, `okpqc_x25519_shared()`: "Clamp the stored scalar (RFC 7748); Curve25519::eval() does not."
  (the X25519 half of the post-quantum keys).

**Consequences of the current code:**

- **The keys work.** The public key and every ECDH use the same unclamped scalar, so they agree with each other and with
  any peer that only sees the public key.
- **They are not standard X25519.** For the same 32 private-key bytes the device's public key and shared secrets differ
  from any RFC 7748 implementation's - unless the bytes are already in clamped form (about 1 random key in 16). So a key
  cannot be moved between the OnlyKey and other X25519 software by its private bytes.
- **The protection clamping gives is missing.** With an attacker-chosen point and a visible result, a peer can learn at
  most the lowest 3 bits of the scalar - about 252 bits of security remain. Not a practical break; a gap in a security
  device. No timing difference: the ladder always runs its full length.

## 2. The patch

`0014-okcrypto-clamp-X25519-scalars-RFC-7748.patch` - `onlykey/okcrypto.cpp` only, +15 / -2, `git am` clean on `fe9e293`.
Both places clamp a **copy** of the scalar, use it, and wipe it:

```c
uint8_t s[32];
memcpy(s, ecc_private_key, 32);
s[0] &= 0xF8;
s[31] = (s[31] & 0x7F) | 0x40;
Curve25519::eval(secret, s, pub);   /* okcrypto_compute_pubkey: Curve25519::eval(ecc_public_key, s, 0) */
memset(s, 0, sizeof(s));
```

The stored key is not changed. The all-zero check `fe9e293` added after the ECDH stays.

## 3. What changes with the patch - and what does not

Everything that reaches those two functions as **key type 4 (`KEYTYPE_CURVE25519`)** changes, for about 15 in 16 keys
(a key already in clamped form gives the same values before and after).

| What | Where (`fe9e293`) | Changes? | How we know |
|---|---|---|---|
| **Curve25519 slot keys (type 4)**, generated on the device or loaded unclamped: their public key and every ECDH | `okcrypto.cpp:2428`, `:1158` | **yes** | **measured** - the RFC 7748 vector, section 5 |
| **Ed25519 / NaCl slot keys (type 1) used for X25519**: an ECDH/decrypt with the slot (converted to type 4), and a public-key read asking for type 4 | `okcrypto.cpp:976-980`, `:722-725` | **yes** | from the source |
| **Agent-derived X25519 keys** (vendor codes 204 / v1 and 224 / v2): the ECDH keys of the SSH/GPG agent derivation, e.g. the **cv25519 encryption subkey of an OnlyKey GPG identity** | the agent derivation into the type-4 path | **yes** | **measured** on one key: an agent-derived X25519 public key `dfedbf1c1e52fb39...` became `e4a0139a7f4a89a6...`; the same key's Ed25519 did not change |
| **Label-derived X25519 over FIDO2** (slot 128 - the web derivation; opt2 NaCl or Curve25519 both derive a type-4 key) | `fido2/ok_extension.cpp` (`okcrypto_derive_key(KEYTYPE_CURVE25519, ...)`, then `okcrypto_shared_secret` near `:367`) | **yes** | from the source. Note: the apps.onlykey.io vault derives with **P-256** (`src/plugins/vault/vault.js:350`) and is **not** affected; a site or app that chose X25519 is |
| **Backups encrypted with a Curve25519 (type 4) ECC backup key** - any ECC slot can be the backup key (`okcore.cpp`, only PQC is refused). The backup and the restore derive their key from an ECDH of the backup key with its own public key | backup `okcore.cpp:6347`, restore `okcore.cpp:6596` | **yes - a backup made before the upgrade is expected NOT to restore after it** (and the reverse) | from the source; **not measured**. Whether the restore notices the wrong key before it writes anything was not checked |
| Ed25519 signing | | no | |
| P-256, secp256k1 (sign and ECDH) | | no | |
| **NaCl ECDH (type 1)** through `crypto_box_beforenm` - including the **WebAuthn tunnel's transit key** (`ok_extension.cpp:241-242`: `type = 1`) | `okcrypto.cpp` `case KEYTYPE_NACL` | no - TweetNaCl clamps inside `crypto_scalarmult` | from the source; the transit key is per-session anyway |
| The X25519 half of the post-quantum (X-Wing / composite) keys | `okpqc.cpp:61` | no - already clamps | from the source |
| RSA | | no | |

**What a user would see after an upgrade with the patch as written:** any X25519 public key published from the key
(a GPG cv25519 subkey, an age/agent X25519 recipient, a public key read from a type-4 or type-1 slot as X25519, a site's
derived X25519 key) is replaced by another; data encrypted to the old public key no longer decrypts; a backup made with a
Curve25519 backup key does not restore. Nothing changes for P-256, secp256k1, Ed25519 signatures, RSA, or NaCl.

## 4. Options

Each is a real option; none is recommended here.

| | Option | What it keeps | What it costs |
|---|---|---|---|
| A | **Do not take it.** Document that OnlyKey X25519 is unclamped (non-standard) | every existing key and backup | keys stay non-interoperable by private bytes; the low-bit gap stays |
| B | **Clamp everywhere**, in one release, with migration notes: re-export X25519 public keys (GPG subkey, agent/age recipients), decrypt or re-encrypt old data with the old firmware first, make a new backup if the backup key is Curve25519 | nothing old - a clean, standard X25519 everywhere | users must migrate before upgrading; anything missed is lost |
| C | **Clamp only what is new**: clamp a key when it is generated or loaded (store the clamped scalar - the unclamped `eval()` of an already-clamped scalar is RFC X25519), and give derivations a new version (e.g. agent derivation v3, a new web-derivation keytype) while v1/v2 stay as they are | every existing key and backup; new keys are standard | two behaviours to document and keep; old keys stay non-standard; derived keys need the version bump to move |
| D | **Opt-in per key**: a type or feature bit that says "clamped" (or a config setting) | everything by default | another setting; users must know to choose it |
| E | **Any of B-D, with the backup path held apart**: keep the backup key's ECDH as it is, or record in the backup which way it was made, so every backup made before still restores | backups across the upgrade | one more special case in backup/restore |

## 5. The test (it fails on 3.1.0 as released and passes with 0014)

`tests/x25519_check.py` - python-onlykey, the RFC 7748 section 6.1 vector (a private key not in clamped form). Its own
header gives the steps: config mode, load three ECC slots with `onlykey-cli setkey`, replug, run it, enter the code it
shows. ECC1 holds the RFC key; ECC3 holds the same key clamped on the host - the control, which must give the RFC values
on both firmwares, so clamping is shown to be the only difference. It ends with `RESULT: PASS / FAIL / INVALID` and exits
0 / 1 / 2.

**Measured 2026-10-28** - two DEBUG soft keys (the OnlyKey firmware compiled for Linux by node-onlykey-emulator, presented
as a real OnlyKey on USB), built from one emulator commit; python-onlykey 1.3.0's `onlykey-cli` and the script, run
exactly as the header says (logs in `results/`):

| firmware | ECC1 public | ECC1 shared | ECC3 (control) | RESULT |
|---|---|---|---|---|
| 3.1.0 as released (`fe9e293`) | `d23c65b6...` - u(k·B), not clamped | `4d7e7399...` - k·bobPub, not clamped | RFC values | **FAIL** (exit 1) |
| 3.1.0 + 0014 alone | `8520f009...` - **RFC public key** | `4a5d9d5b...` - **RFC shared secret** | RFC values | **PASS** (exit 0) |

Not run: a hard key (the same firmware sources; DEBUG or not does not touch this path), the backup/restore case, the
type-1-as-X25519 and web-derivation cases (from the source only).

## 6. Questions only the maintainer can answer

1. Take it, not take it, or take it in a later release?
2. If taken: everywhere (B), new keys only (C), opt-in (D)?
3. Backups: must every backup made before the upgrade still restore after it (E)?
4. How many users have X25519 keys in play - GPG cv25519 subkeys from onlykey-agent, age recipients, type-4 slot keys,
   Curve25519 backup keys? (Which would decide how much B costs.)
5. What should the release notes tell them, and in which order (export, decrypt, back up, upgrade)?
