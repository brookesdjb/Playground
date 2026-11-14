#!/usr/bin/env bash
# Build "Hotspot Bridge" firmware for the TP-Link TL-WR902AC v4 with the
# official OpenWrt ImageBuilder, plus stock-firmware restore images.
#
# Needs: bash, curl, make, gcc-less host is fine, perl, python3, gawk, zstd,
#        unzip-capable python (stdlib zipfile is used), ~1.5 GB disk.
# Output: ./out/
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-$HERE/.work}
OUT=${OUT:-$HERE/out}

OWRT_VER=25.12.6
TARGET=ramips/mt76x8
PROFILE=tplink_tl-wr902ac-v4
IB_NAME=openwrt-imagebuilder-${OWRT_VER}-ramips-mt76x8.Linux-x86_64
IB_URL=https://downloads.openwrt.org/releases/${OWRT_VER}/targets/${TARGET}/${IB_NAME}.tar.zst
IB_SHA256=7f26c50440cadd83362c444778f80f4a214ee76f3c192ef85ef074f2c56d89ec

# Last unencrypted TP-Link release for TL-WR902AC v4 (EU), used for restore images.
STOCK_URL='https://static.tp-link.com/upload/firmware/2025/202501/20250126/TL-WR902ACv4_EU_0.9.1_0.3_up_boot%5B240903-rel41878%5D.zip'
STOCK_ZIP_SHA256=a5ffea54f7bbef580e08c41786b23f405b38b6b1fccb9f389b032ba43ca989bc
STOCK_BIN_SHA256=aa58a4ae0ce86332236abc5449cf2da2450d7f412470c86102b2e40c911c5500

# Two variants (the 8 MB flash can't hold everything):
#   standard: LuCI web admin + WPA3/OWE uplinks
#   iphone:   + iPhone USB tethering (ipheth + usbmuxd); drops LuCI, WPA3/OWE,
#             PPPoE, IPv6 DHCP server, the apk package manager and HTTPS certs
PKGS_standard="luci iw"
PKGS_iphone="uhttpd rpcd rpcd-mod-iwinfo kmod-usb-net-ipheth usbmuxd \
	-ppp -ppp-mod-pppoe -apk-mbedtls -ca-bundle -libustream-mbedtls \
	-odhcpd-ipv6only -kmod-nft-offload -wpad-basic-mbedtls wpad-mini"
VARIANTS=${VARIANTS:-"standard iphone"}
FW_PART=7995392          # firmware partition; the rest after the image holds settings
MIN_FREE=262144          # require >= 256 KiB left for the settings overlay

mkdir -p "$WORK" "$OUT"

fetch() { # url dest sha256
	if [ ! -f "$2" ] || ! echo "$3  $2" | sha256sum -c --status; then
		echo ">> downloading $(basename "$2")"
		curl -fL --retry 3 -o "$2.part" "$1"
		mv "$2.part" "$2"
	fi
	echo "$3  $2" | sha256sum -c
}

# ---- ImageBuilder ----------------------------------------------------------
fetch "$IB_URL" "$WORK/$IB_NAME.tar.zst" "$IB_SHA256"
if [ ! -d "$WORK/$IB_NAME" ]; then
	echo ">> extracting ImageBuilder"
	tar --zstd -xf "$WORK/$IB_NAME.tar.zst" -C "$WORK"
fi

# ---- Overlay: fix permissions (git doesn't keep them reliably) --------------
STAGE_FILES="$WORK/files"
rm -rf "$STAGE_FILES"
cp -a "$HERE/files" "$STAGE_FILES"
chmod 0755 "$STAGE_FILES/www/cgi-bin/hb" \
	"$STAGE_FILES/etc/init.d/hotspotbridge" \
	"$STAGE_FILES/etc/uci-defaults/90-hotspotbridge" \
	"$STAGE_FILES/usr/libexec/hotspotbridge/ensure-wifi" \
	"$STAGE_FILES/etc/hotplug.d/ieee80211/20-hotspotbridge" \
	"$STAGE_FILES/etc/hotplug.d/net/30-hotspotbridge-iphone"

# ---- Build -----------------------------------------------------------------
for v in $VARIANTS; do
	eval "pkgs=\$PKGS_$v"
	echo ">> building $PROFILE ($v)"
	rm -rf "$OUT/openwrt-$v" "$OUT/$v"
	make -C "$WORK/$IB_NAME" image \
		PROFILE="$PROFILE" \
		PACKAGES="$pkgs" \
		FILES="$STAGE_FILES" \
		EXTRA_IMAGE_NAME="hotspotbridge-$v" \
		BIN_DIR="$OUT/openwrt-$v"

	sysup=$(ls "$OUT/openwrt-$v"/*-squashfs-sysupgrade.bin 2>/dev/null || true)
	tftp=$(ls "$OUT/openwrt-$v"/*-squashfs-tftp-recovery.bin 2>/dev/null || true)
	[ -n "$sysup" ] && [ -n "$tftp" ] || { echo "!! $v: image too big for flash" >&2; exit 1; }
	free=$((FW_PART - $(stat -c %s "$sysup")))
	echo ">> $v: $free bytes left for settings"
	[ "$free" -ge "$MIN_FREE" ] || { echo "!! $v: only $free bytes left for settings" >&2; exit 1; }

	mkdir -p "$OUT/$v/install-via-tftp"
	cp "$tftp" "$OUT/$v/install-via-tftp/tp_recovery.bin"
	cp "$sysup" "$OUT/$v/hotspotbridge-$v-sysupgrade.bin"
done

# ---- Stock restore images ----------------------------------------------------
fetch "$STOCK_URL" "$WORK/stock-0.9.1.zip" "$STOCK_ZIP_SHA256"
python3 -I - "$WORK/stock-0.9.1.zip" "$WORK/stock-0.9.1.bin" <<'PY'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
name = next(n for n in z.namelist() if n.endswith('.bin'))
open(sys.argv[2], 'wb').write(z.read(name))
PY
echo "$STOCK_BIN_SHA256  $WORK/stock-0.9.1.bin" | sha256sum -c
python3 -I "$HERE/tools/make-stock-restore.py" "$WORK/stock-0.9.1.bin" "$OUT/restore-stock"
mkdir -p "$OUT/restore-stock/via-tftp"
mv "$OUT/restore-stock/tp_recovery.bin" "$OUT/restore-stock/via-tftp/tp_recovery.bin"
cp "$WORK/stock-0.9.1.bin" "$OUT/restore-stock/TL-WR902ACv4_EU_0.9.1_stock-original.bin"

( cd "$OUT" && find . -name '*.bin' -type f | sort | xargs sha256sum > SHA256SUMS )
echo
echo ">> done:"
cat "$OUT/SHA256SUMS"
