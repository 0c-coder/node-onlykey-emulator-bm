# Start here - patch 0014 (X25519 clamping), for Tim and his Claude session

This package is one firmware change and everything known about it, so the maintainer can decide. **The change itself is
small; its consequence is not: it changes X25519 keys that already exist.** The decision - take it or not, when, and how
users migrate - is the maintainer's. Nothing here argues for an answer.

## Read in this order

1. **`DECISION.md`** - the issue, the exact source lines (libraries `fe9e293`), what the patch changes and what it does
   not, the options with what each keeps and costs, the measured results, the open questions.
2. **`0014-okcrypto-clamp-X25519-scalars-RFC-7748.patch`** - the change: `onlykey/okcrypto.cpp`, +15 / -2.
3. **`tests/x25519_check.py`** - the test: fails on 3.1.0 as released, passes with the patch. Its header has the steps.
4. **`results/`** - the run that showed both: `proof.log` (both firmwares end to end), `test-released.log`,
   `test-p0014.log`.

## For the Claude session: check, don't trust

Every claim in DECISION.md is marked **measured** or **from the source**. Check the source claims against the tree:

```sh
git -C libraries show fe9e293:onlykey/okcrypto.cpp | sed -n '2412,2430p'   # compute_pubkey: Curve25519 unclamped
git -C libraries show fe9e293:onlykey/okcrypto.cpp | sed -n '1124,1162p'   # shared_secret: NaCl / P-256 / Curve25519
git -C libraries show fe9e293:onlykey/okcrypto.cpp | sed -n '970,985p'     # type 1 used for X25519 becomes type 4
git -C libraries show fe9e293:onlykey/okcrypto.cpp | sed -n '718,726p'     # public key read: type 1 asked as type 4
git -C libraries show fe9e293:onlykey/okpqc.cpp    | sed -n '55,66p'       # the PQ X25519 half already clamps
git -C libraries show fe9e293:Crypto/Curve25519.cpp | sed -n '245,256p'    # dh1() clamps before eval()
git -C libraries show fe9e293:fido2/ok_extension.cpp | sed -n '236,246p'   # transit key: type 1 (NaCl) - unaffected
git -C libraries show fe9e293:onlykey/okcore.cpp   | sed -n '6330,6350p'   # backup: ECDH of the backup key
git -C libraries show fe9e293:onlykey/okcore.cpp   | sed -n '6580,6598p'   # restore: the same ECDH
git -C libraries apply --check 0014-okcrypto-clamp-X25519-scalars-RFC-7748.patch   # applies to fe9e293
```

Then run the test on a **development** key (it overwrites ECC slots 101-103), once on the current firmware and once with
the patch: the first must end `RESULT: FAIL`, the second `RESULT: PASS`. The backup/restore consequence is from the source
only - a session wanting certainty can measure it: set a Curve25519 key as the backup key, back up on the current
firmware, flash the patched one, restore.

## What is not in here

No recommendation. The options in DECISION.md section 4 are each written with what they keep and what they cost.
