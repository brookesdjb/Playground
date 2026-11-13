# Hotspot Bridge firmware — TP-Link TL-WR902AC v4

A minimal OpenWrt-based firmware that connects to a Wi-Fi hotspot as a client,
**using any MAC address you choose** (clone your laptop after logging in to the
captive portal), and shares that connection on the Ethernet port and on a small
setup Wi-Fi network. Ships with a simple web page, LuCI for advanced settings,
and a one-click way back to TP-Link stock firmware.

Built from the official OpenWrt **25.12.6** ImageBuilder (`ramips/mt76x8`,
profile `tplink_tl-wr902ac-v4`): stock OpenWrt kernel and Wi-Fi drivers, plus the
overlay in `files/`.

> **Why the official OpenWrt file "fails to flash":** for the v4 OpenWrt has no
> *factory* image, and TP-Link's web updater refuses anything else. The v4 can
> only be installed through the bootloader's TFTP recovery, described below.
> The same applies to this firmware.

## Files (after `./build.sh`, in `out/`)

| File | Use |
|---|---|
| `install-via-tftp/tp_recovery.bin` | Install Hotspot Bridge through TFTP recovery (first install) |
| `hotspotbridge-sysupgrade.bin` | Update an existing Hotspot Bridge/OpenWrt install from the web page |
| `restore-stock/TL-WR902ACv4_EU_0.9.1_stock-original.bin` | Restore TP-Link firmware from the Hotspot Bridge web page |
| `restore-stock/via-tftp/tp_recovery.bin` | Restore TP-Link firmware through TFTP recovery (works even if Linux won't boot) |
| `restore-stock/stock-firmware-part.bin` | Same as above, pre-stripped to the `firmware` partition (for `sysupgrade -F -n`) |
| `SHA256SUMS` | Checksums |

Keep **both** `tp_recovery.bin` files on your laptop before you start. The
parents' house has no internet, so you can't download them later.

## 1. Install (TFTP recovery)

You need a laptop with an Ethernet port (or a USB adapter) and a TFTP server:
Windows: **Tftpd64**; macOS: built-in `tftpd` or **TftpServer**; Linux: `dnsmasq` or `tftpd-hpa`.

1. Put `install-via-tftp/tp_recovery.bin` in the TFTP server's folder. The name must be exactly `tp_recovery.bin`.
2. Give the laptop's Ethernet port the static address **192.168.0.66**, netmask 255.255.255.0.
   Turn the laptop's Wi-Fi off, and allow TFTP (UDP 69) through its firewall.
3. Connect the laptop to the router's Ethernet port with a cable.
4. With the router **unpowered**, hold the **Reset** button, plug in the power (micro-USB), and keep
   holding for about 8-10 seconds until the LED starts blinking. Then let go.
5. The router downloads the file (the TFTP log shows the transfer), writes it, and reboots. Allow 2-3 minutes.
   Don't unplug it during that time.

Linux example: `sudo dnsmasq --no-daemon --port=0 --enable-tftp --tftp-root="$PWD/out/install-via-tftp" --interface=eth0 --listen-address=192.168.0.66`

If nothing is requested, repeat step 4 holding reset a little longer or shorter, and check the
laptop's address and firewall.

## 2. First use

1. Set the laptop's Ethernet back to **DHCP** (automatic). The router hands out 192.168.88.x.
   You can also join the open Wi-Fi **`HotspotBridge-XXXX`**.
2. Open **http://192.168.88.1**.
3. **Firmware → Download factory** once and keep the file. It holds this unit's Wi-Fi calibration.
   "Download full 8 MB flash" is a complete backup.
4. Set the **Wi-Fi country code** if you're not in the UK (default `GB`).
5. Optional: give the setup Wi-Fi a password.

## 3. Get online through the hotspot (the MAC trick)

1. On the laptop, join the public hotspot over Wi-Fi and log in to its portal as usual.
2. Find the MAC address the laptop used **for that network**. Most operating systems use a random MAC per network:
   * Windows: Settings → Wi-Fi → the hotspot → Properties → *Physical address (MAC)*. If "Random hardware
     addresses" is on, this per-network value is the one you need.
   * macOS: Wi-Fi → (i) Details → *Wi-Fi address* (shown when Private Wi-Fi address is on).
   * Linux: `ip link show wlan0`. With NetworkManager, the randomised MAC is shown while connected.
3. **Disconnect the laptop from the hotspot and turn off auto-join.** Two devices with the same MAC
   on one network will knock each other off.
4. Plug the laptop into the router's Ethernet port and open http://192.168.88.1.
5. **Connect to a hotspot**: choose the band, **Scan**, tap the hotspot, paste the MAC into
   *"Use this MAC address on the uplink"*, then press **Connect**.
6. After about 15 seconds, the Status box should show *connected* with an Uplink IP. Press
   **Check internet**:
   * *online*: you're done.
   * *captive portal*: the portal didn't accept the cloned MAC (or its session expired). Log in once
     more from a device behind the router; the router forwards the login.

**Reverse trick (no cloning):** leave the MAC empty and connect, then copy the *Uplink MAC* shown in
Status to your laptop's Wi-Fi adapter and log in to the portal with the laptop.

Notes
* The setup Wi-Fi is switched off on the band the uplink uses, and stays on the other band. Ethernet always works.
* Supported security: open, OWE, WPA/WPA2/WPA3-Personal. Enterprise (802.1X, e.g. eduroam) is not supported.
* DNS rebind protection is off so portals that resolve to private IPs work.
* The setup page has no login; only devices on the LAN side can reach it. LuCI is at
  `/cgi-bin/luci` (user `root`, no password until you set one in LuCI → System → Administration).

## 4. Restore TP-Link stock firmware

**From the web page:** Firmware → *Restore TP-Link stock firmware* → choose
`restore-stock/TL-WR902ACv4_EU_0.9.1_stock-original.bin` (or the TFTP or stripped variant) → Restore.
The page checks the file before writing anything: it must have TP-Link's header, the v4 hardware ID
`0x0902AC04`, and a readable root filesystem. It then writes only the `firmware` partition. The
bootloader and the factory/config partitions are never touched. The router reboots into TP-Link
firmware at http://tplinkwifi.net (192.168.0.254), default login `admin`.

**From TFTP (always available, even if Linux won't boot):** follow section 1 using
`restore-stock/via-tftp/tp_recovery.bin` instead.

**Encrypted stock releases:** TP-Link's current downloads (0.9.3, 2025 and later) are encrypted and can't
be written raw. Restore 0.9.1 first, then use TP-Link's own *Firmware Upgrade* page to move to the latest.

## How the stock restore images are made

TP-Link's 0.9.1 `.bin` is a 512-byte updater header, followed by a raw image of flash
0x000000-0x7BFFFF: 128 KiB bootloader, then the 0x7A0000 `firmware` partition. That partition
begins with its own `ver. 2.0` TP-Link header, the same layout OpenWrt uses.
`tools/make-stock-restore.py` checks those headers and the squashfs and cuts out:

* skip 0x200 → `tp_recovery.bin`: 8,126,464 bytes, the same size and layout as OpenWrt's own tftp-recovery image
* skip 0x20200 → `stock-firmware-part.bin`: exactly the 7,995,392-byte `firmware` partition

## Building

```sh
./build.sh          # needs curl, make, perl, python3, gawk, zstd; ~1.5 GB disk
```
Downloads are pinned by SHA-256: the ImageBuilder from downloads.openwrt.org and the stock firmware from
static.tp-link.com. The overlay is in `files/`:

* `etc/uci-defaults/90-hotspotbridge`: first boot sets LAN 192.168.88.1, adds `wwan` (DHCP) to the wan firewall zone, and disables DNS rebind protection
* `usr/libexec/hotspotbridge/ensure-wifi`: setup AP on each radio, plus a disabled `uplink` STA (runs from boot and from Wi-Fi hotplug, and is safe to repeat)
* `www/hb/index.html` and `www/cgi-bin/hb`: the web page and its JSON API (POSTs require an `X-HB: 1` header)

## Status / caveats

* Built and checked off-device: the image layout matches the official v4 TFTP image, and the shell
  scripts and web page were exercised with stubs. **It has not been run on a real TL-WR902AC v4 yet.**
  The kernel, drivers and partition map are OpenWrt's own for this model. If something misbehaves,
  TFTP recovery (section 4) always brings back stock.
* The 5 GHz chip (MT7613) uses OpenWrt's AP-optimised firmware. Client mode on 5 GHz should work,
  but 2.4 GHz usually has the better range to a nearby hotspot anyway.
