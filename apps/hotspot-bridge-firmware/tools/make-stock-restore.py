#!/usr/bin/env python3
"""Turn a TP-Link TL-WR902AC v4 stock firmware .bin into restore images.

TP-Link's (unencrypted, 0.9.1) download is laid out as:

    0x000000  512-byte TP-Link header for the web updater
    0x000200  128 KiB bootloader  (flash 0x000000-0x01FFFF, "boot")
    0x020200  7808 KiB firmware   (flash 0x020000-0x7BFFFF, "firmware")

Outputs:
    tp_recovery.bin           bootloader TFTP recovery image (same layout and
                              size as OpenWrt's *-tftp-recovery.bin)
    stock-firmware-part.bin   exactly the "firmware" partition, for
                              `sysupgrade -F -n` / the Hotspot Bridge web UI

Usage: make-stock-restore.py STOCK.bin OUTDIR
"""
import hashlib
import os
import struct
import sys

HDR = 0x200
BOOT = 0x20000
FW = 0x7A0000
STOCK_SIZE = HDR + BOOT + FW          # 8126976
ENCRYPTED_SIZE = 8127024              # 0.9.3+ releases
HWID = 0x0902AC04
HWREV = 0x89


def check_tp_header(buf, where):
    if buf[4:12] != b"ver. 2.0":
        sys.exit(f"{where}: TP-Link 'ver. 2.0' header not found")
    hwid, hwrev = struct.unpack(">II", buf[0x34:0x3C])
    if hwid != HWID or hwrev != HWREV:
        sys.exit(f"{where}: hardware id {hwid:#010x}/{hwrev:#x} is not TL-WR902AC v4 "
                 f"({HWID:#010x}/{HWREV:#x})")
    fw_len, kofs, klen, rofs, rlen = struct.unpack(">5I", buf[0x70:0x84])
    return kofs, klen, rofs, rlen


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, outdir = sys.argv[1], sys.argv[2]
    data = open(src, "rb").read()
    if len(data) == ENCRYPTED_SIZE:
        sys.exit("This is an encrypted 0.9.3+ release; use the 0.9.1 release (240903) instead.")
    if len(data) != STOCK_SIZE:
        sys.exit(f"Unexpected size {len(data)} (want {STOCK_SIZE})")

    check_tp_header(data, "outer header")
    boot = data[HDR:HDR + BOOT]
    fw = data[HDR + BOOT:]
    assert len(fw) == FW
    kofs, klen, rofs, rlen = check_tp_header(fw, "firmware partition")
    if fw[rofs:rofs + 4] != b"hsqs":
        sys.exit("No squashfs at the header's rootfs offset - encrypted or damaged image")
    if rofs + rlen > FW or kofs + klen > rofs:
        sys.exit("Header offsets do not fit the firmware partition")
    if boot[:4] == b"\xff\xff\xff\xff":
        sys.exit("Bootloader area is empty - unexpected layout")

    os.makedirs(outdir, exist_ok=True)
    outs = {
        "tp_recovery.bin": boot + fw,
        "stock-firmware-part.bin": fw,
    }
    for name, blob in outs.items():
        path = os.path.join(outdir, name)
        with open(path, "wb") as f:
            f.write(blob)
        print(f"{name:26s} {len(blob):8d} bytes  sha256 {hashlib.sha256(blob).hexdigest()}")
    print(f"kernel @{kofs:#x} len {klen:#x}, rootfs (squashfs) @{rofs:#x} len {rlen:#x}")


if __name__ == "__main__":
    main()
