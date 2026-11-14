# Hotspot Bridge firmware: notes for Claude

Custom firmware for the **TP-Link TL-WR902AC v4** (MT7628AN + MT7613BE, 8 MB flash, 64 MB RAM).
It's an overlay (`files/`) on the official OpenWrt 25.12.6 ImageBuilder: Wi-Fi client uplink with a
user-set MAC (captive-portal MAC cloning), shared over Ethernet and a setup AP, plus an optional
iPhone USB tethering variant. User-facing docs are in `README.md`.

**Not yet run on real hardware.** Treat anything about on-device runtime behaviour as unverified.

## Layout
- `build.sh`: downloads the ImageBuilder and TP-Link 0.9.1 stock firmware (pinned by SHA-256), then builds
  the `standard` and `iphone` variants into `out/` along with the stock-restore images.
  Needs curl, make, perl, python3, gawk, zstd. `WORK`, `OUT` and `VARIANTS` can be overridden.
- `files/etc/uci-defaults/90-hotspotbridge`: first boot sets LAN 192.168.88.1, creates `wwan` (DHCP,
  metric 20), `iphone` (metric 10, only if ipheth is present) and `wwan6` (only if odhcp6c is present),
  adds them to the firewall wan zone, and turns off DNS rebind protection.
- `files/usr/libexec/hotspotbridge/ensure-wifi`: idempotent, run per radio. It creates `setup_<radio>` APs
  and a disabled `uplink` STA (ifname `hbsta`). Runs from init (S99) and from ieee80211 hotplug.
- `files/www/cgi-bin/hb`: POSIX sh / busybox ash JSON API (jshn, jsonfilter, uci, ubus).
  `files/www/hb/index.html` is the web page and uses only vanilla JS.
- `tools/make-stock-restore.py`: strips TP-Link's 0.9.1 image into TFTP and partition-only restore images.
- `tests/`: host-side tests that use busybox plus Python stand-ins for uci and jsonfilter. Run them after `./build.sh`:
  `bash tests/test-config.sh`, `bash tests/test-restore.sh` (`OUT=...`, optional `EXTRA_STOCK_DIR=`), and
  `node tests/ui-test.js out.png` (needs Playwright). Install busybox on the host first.

## Hard-won facts (don't relearn these)
- **The v4 only installs through bootloader TFTP**: PC at 192.168.0.66, file `tp_recovery.bin`, hold reset
  while powering on. TP-Link's web updater rejects OpenWrt images, and OpenWrt builds no factory image for the v4.
- **Flash map:** boot 0x0-0x20000 (never write it), firmware 0x20000 (size 0x7A0000), config 0x7C0000,
  factory 0x7D0000 (Wi-Fi calibration and MAC).
- **TP-Link stock 0.9.1 `.bin`** = 0x200 header + 128 KiB bootloader + firmware partition. Skip 0x200 to get the
  TFTP image; skip 0x20200 to get the partition (`sysupgrade -F -n`). The stock header's hardware ID is `0x0902AC04`,
  while OpenWrt's image uses `0x000DC88F`. **0.9.3 and later releases are encrypted** (8127024 bytes) and
  can't be written raw.
- **uhttpd only passes a fixed list of headers to CGI** (Accept*, Authorization, Connection, Cookie, Host,
  Origin, Referer, User-Agent, X-HTTP-Method-Override, Content-Type/Length). Custom `X-*` headers never
  arrive. CSRF protection therefore relies on a JSON/octet-stream Content-Type plus an Origin == Host check.
  Tests must pass only these variables.
- OpenWrt leaves the Wi-Fi `country` empty (world domain), where a 5 GHz AP can't start. ensure-wifi sets
  `hotspotbridge.main.country` (default GB) on new radios.
- **iphone variant size budget:** ipheth + usbmuxd pull in libopenssl3, libxml2 and usbids (~6 MB unpacked). To fit,
  it drops LuCI, WPA3/OWE (wpad-mini), ppp, apk, ca-bundle, ustream and odhcpd. About 320 KB of flash is left for the
  overlay; `build.sh` fails if less than 256 KB remains. iPhone pairing records live in `/etc/lockdown` (persistent).
- busybox `wc -c` pads its output with spaces, so wrap it in `$(( ))` before using it in env assignments.

## Conventions
- Router scripts: POSIX sh for busybox ash, no bashisms. Check with `busybox ash -n` and `shellcheck -s sh`.
- Keep the web page dependency-free, and keep both variants working. The page reads `features` from the status call.
