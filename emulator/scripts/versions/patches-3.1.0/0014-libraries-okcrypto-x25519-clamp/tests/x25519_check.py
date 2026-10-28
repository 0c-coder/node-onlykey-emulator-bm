#!/usr/bin/env python3
"""X25519 (RFC 7748) conformance check for OnlyKey ECC slots, with python-onlykey - the test for patch 0014.

It FAILS on 3.1.0 as released (libraries fe9e293: the scalar is not clamped) and PASSES with patch 0014.

DEVELOPMENT OnlyKey only - this overwrites ECC slots 101-103. Never on a key that holds real keys.

The RFC 7748 section 6.1 test vector: Alice's private key k, her public key, Bob's public key, and their shared
secret. k is NOT in clamped form, which is exactly what tells a clamping implementation from one that skips it.

Byte order: the firmware stores the 32 bytes as sent and byte-reverses them before Curve25519::eval()
(okcrypto.cpp, okcrypto_compute_pubkey / okcrypto_shared_secret), which reads its scalar little-endian. So an RFC
7748 private key (little-endian bytes) is sent REVERSED. Public keys and shared secrets come back in RFC order.

1. Config mode: unlock, hold button 6 for 5+ s, re-enter the PIN. Then load three slots:
     onlykey-cli setkey ECC1 c d 2a2cb91da5fb77b12a99c0eb872f4cdf4566b25172c1163c7da518730a6d0777   # rev(k): the RFC key
     onlykey-cli setkey ECC2 c d 77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a   # k unreversed (info)
     onlykey-cli setkey ECC3 c d 6a2cb91da5fb77b12a99c0eb872f4cdf4566b25172c1163c7da518730a6d0770   # rev(clamp(k)): control
   (c = KEYTYPE_CURVE25519 (4), d = decrypt: type byte 0x24.)
2. Replug (OKGETPUBKEY is refused in config mode), unlock, then:
     python3 x25519_check.py            # reads the three public keys, then two ECDHs - enter the code it shows, each time
     python3 x25519_check.py --dry-run  # no device: prints the frames and codes only

RESULT (last line; exit 0 / 1 / 2):
  PASS     ECC1, the RFC key, gives the RFC public key and the RFC shared secret - the scalar is clamped
  FAIL     ECC1 gives other values while the control (ECC3, the same key clamped on the host) gives the RFC ones:
           the firmware does not clamp - clamping is the only difference
  INVALID  the control itself is not the RFC values (wrong keys loaded, wrong byte order, no answer): nothing proven
"""
import sys
import time

from onlykey.client import OnlyKey
from onlykey.protocol import Message, challenge_code_str

RFC_PUB = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a'
RFC_SHARED = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742'
BOB_PUB = bytes.fromhex('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f')
KNOWN = {
    RFC_PUB: 'RFC X25519(k) = RFC public key (conformant)',
    'd23c65b66ad6757a03693fec52b63c3ebb2d86e64065895a728995f14f907f14': 'u(k*B), k NOT clamped (non-conformant)',
    '9c9a626e5ac9b1155b85009093a726b6c4b0551a446906f87d125f60b4e50866': 'u(rev(k)*B), not clamped (wrong byte order AND not clamped)',
    '8f42256853f5b918ab1b664d9c504bda4a5684b1be6f95ecc730b515911c8001': 'RFC X25519(rev k) (wrong byte order, clamped)',
    RFC_SHARED: 'RFC shared secret (conformant)',
    '4d7e7399c5b77bc552cdb8cca0c409a9d6360128e239020927dda70daabd4075': 'k*bobPub, k NOT clamped (non-conformant)',
}


class FakeHid(object):
    def write(self, b):
        print('  frame %s|%s' % (bytes(b[:7]).hex(), bytes(b[7:39]).hex()))

    def read(self, n, timeout_ms=0):
        return []


def is_text(r):
    return len(r) >= 4 and all(32 <= c < 127 for c in r[:4])


def read_answer(ok, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        r = ok.read_bytes(64, timeout_ms=500)
        if not r:
            continue
        if is_text(r):
            print('  device: %s' % bytes(r).split(b'\0')[0].decode(errors='replace'))
            continue
        return bytes(r[:32]).hex()
    return None


def verdict(h):
    return KNOWN.get(h, 'no known value')


def main():
    dry = '--dry-run' in sys.argv
    ok = OnlyKey(connect=False) if dry else OnlyKey()
    if dry:
        ok._hid = FakeHid()
    pub, shared = {}, {}
    for slot in (101, 102, 103):
        print('OKGETPUBKEY slot %d' % slot)
        ok.send_message(msg=Message.OKGETPUBKEY, slot_id=slot)
        if not dry:
            pub[slot] = read_answer(ok, 5)
            print('  public %s -> %s' % (pub[slot], verdict(pub[slot])))
    for slot in (101, 103):
        print('OKDECRYPT (X25519 ECDH) slot %d with RFC 7748 Bob public key' % slot)
        ok.send_message(msg=Message.OKDECRYPT, slot_id=slot, payload=bytearray([len(BOB_PUB)]) + BOB_PUB)
        print('  enter %s on the OnlyKey' % challenge_code_str(BOB_PUB))
        sys.stdout.flush()
        if not dry:
            shared[slot] = read_answer(ok, 30)
            print('  shared %s -> %s' % (shared[slot], verdict(shared[slot])))
    if dry:
        return 0

    control = pub.get(103) == RFC_PUB and shared.get(103) == RFC_SHARED
    rfc = pub.get(101) == RFC_PUB and shared.get(101) == RFC_SHARED
    if not control:
        print('RESULT: INVALID - the control (ECC3, the RFC key clamped on the host) did not give the RFC values; '
              'check the keys loaded and their byte order')
        return 2
    if rfc:
        print('RESULT: PASS - ECC1 (the RFC 7748 key) gives the RFC public key and shared secret: the scalar is clamped')
        return 0
    print('RESULT: FAIL - ECC1 (the RFC 7748 key) gives %s / %s while the control gives the RFC values: '
          'the firmware does not clamp the X25519 scalar' % (verdict(pub.get(101)), verdict(shared.get(101))))
    return 1


if __name__ == '__main__':
    sys.exit(main())
