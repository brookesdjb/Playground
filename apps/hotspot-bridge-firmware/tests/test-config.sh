#!/bin/bash
# Host-side test of first-boot defaults, ensure-wifi and the CGI config actions.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
F=$HERE/../files
TMPROOT=${TMPROOT:-$HERE/../.work/tests}
mkdir -p "$TMPROOT"
RUN=$TMPROOT/cfg-$(date +%s)
FK=$RUN/root
mkdir -p "$RUN/bin" "$RUN/uci" "$FK/sys/class/net/eth0" "$FK/var/lock" "$FK/etc" "$FK/proc/net" "$FK/tmp"
echo "40:ed:00:cf:b9:9b" > "$FK/sys/class/net/eth0/address"
printf 'IP address HW type Flags HW address Mask Device\n192.168.88.170 0x1 0x2 aa:bb:cc:00:11:22 * br-lan\n' > "$FK/proc/net/arp"
echo "DISTRIB_DESCRIPTION='OpenWrt 25.12.6 test'" > "$FK/etc/openwrt_release"

for a in hexdump dd wc head tail tr sed grep rm sync awk setsid cut sh sleep cat tee env od busybox; do ln -sf /usr/bin/busybox "$RUN/bin/$a"; done
ln -sf "$(command -v python3)" "$RUN/bin/python3"
cp "$HERE/stubs/uci" "$HERE/stubs/jsonfilter" "$HERE/stubs/flock" "$RUN/bin/"; chmod +x "$RUN/bin/uci" "$RUN/bin/jsonfilter"
printf '#!/bin/sh\necho "wifi $*" >> %s/calls\n' "$RUN" > "$RUN/bin/wifi"
printf '#!/bin/sh\nexit 1\n' > "$RUN/bin/ubus"
printf '#!/bin/sh\n[ "$2" = phyname ] && { [ "$3" = radio0 ] && echo phy0 || echo phy1; }\n' > "$RUN/bin/iwinfo"
chmod +x "$RUN/bin/"*

cat > "$RUN/jshn.sh" <<'E'
_q(){ printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()),end="")'; }
_k(){ [ -n "$1" ] && printf '%s:' "$(_q "$1")"; }
json_init(){ J=""; }
json_add_string(){ J="$J$(_k "$1")$(_q "$2"),"; }
json_add_boolean(){ J="$J$(_k "$1")$([ "$2" = 1 ] && echo true || echo false),"; }
json_add_object(){ J="$J$(_k "${1:-}"){"; }
json_close_object(){ J="$J},"; }
json_add_array(){ J="$J$(_k "$1")["; }
json_close_array(){ J="$J],"; }
json_dump(){ echo "{ $J }" | sed 's/,\([]}]\)/\1/g; s/, }$/ }/'; }
E

rew() { sed -e "s#/usr/share/libubox/jshn.sh#$RUN/jshn.sh#; s#/sys/class/#$FK/sys/class/#g; s#/var/lock/#$FK/var/lock/#g; \
	s#/etc/board.json#$FK/etc/board.json#g; s#/sbin/wifi#$RUN/bin/wifi#g; s#/proc/net/arp#$FK/proc/net/arp#g; \
	s#/etc/openwrt_release#$FK/etc/openwrt_release#g; s#/etc/init.d/hotspotbridge enable#echo enabled-init#; s#/tmp/hb-#$FK/tmp/hb-#g" "$1" > "$2"; }
rew "$F/etc/uci-defaults/90-hotspotbridge" "$RUN/defaults.sh"
rew "$F/usr/libexec/hotspotbridge/ensure-wifi" "$RUN/ensure-wifi"
rew "$F/www/cgi-bin/hb" "$RUN/hb"

export UCI_DIR=$RUN/uci PATH=$RUN/bin
# --- seed configs like a fresh OpenWrt (mac80211.uc output, firewall4 defaults)
python3 - "$RUN/uci" "$F/etc/config/hotspotbridge" <<'PY'
import json, sys, os, re
d = sys.argv[1]
def w(c, secs): json.dump(secs, open(os.path.join(d, c + ".json"), "w"))
S = lambda n, t, o, anon=False: {"name": n, "type": t, "anon": anon, "opts": o}
w("wireless", [
 S("radio0", "wifi-device", {"type": "mac80211", "path": "platform/10300000.wmac", "band": "2g", "channel": "1", "htmode": "HT20", "country": ""}),
 S("default_radio0", "wifi-iface", {"device": "radio0", "network": "lan", "mode": "ap", "ssid": "OpenWrt", "encryption": "none", "disabled": "1"}),
 S("radio1", "wifi-device", {"type": "mac80211", "path": "pci0000:00/0000:00:00.0/0000:01:00.0", "band": "5g", "channel": "36", "htmode": "VHT80", "country": ""}),
 S("default_radio1", "wifi-iface", {"device": "radio1", "network": "lan", "mode": "ap", "ssid": "OpenWrt", "encryption": "none", "disabled": "1"}),
])
w("firewall", [S("d", "defaults", {"input": "REJECT"}, True),
  S("z1", "zone", {"name": "lan", "network": ["lan"]}, True),
  S("z2", "zone", {"name": "wan", "network": ["wan", "wan6"], "masq": "1"}, True)])
w("network", [S("lan", "interface", {"device": "br-lan", "proto": "static", "ipaddr": "192.168.1.1"})])
w("dhcp", [S("d", "dnsmasq", {"rebind_protection": "1"}, True), S("lan", "dhcp", {"interface": "lan"})])
w("system", [S("s", "system", {"hostname": "OpenWrt"}, True)])
# hotspotbridge config from the overlay file
secs = []; cur = None
for line in open(sys.argv[2]):
    m = re.match(r"\s*config (\S+) '(\S+)'", line)
    if m: cur = S(m.group(2), m.group(1), {}); secs.append(cur); continue
    m = re.match(r"\s*option (\S+) '(.*)'", line)
    if m: cur["opts"][m.group(1)] = m.group(2)
w("hotspotbridge", secs)
PY

cgi() { # method action body
	printf '%s' "$3" > "$RUN/body"
	env -i PATH="$PATH" UCI_DIR="$UCI_DIR" REQUEST_METHOD="$1" CONTENT_TYPE=application/json HTTP_HOST=192.168.88.1 HTTP_ORIGIN=http://192.168.88.1 REMOTE_ADDR=192.168.88.170 \
		CONTENT_LENGTH=$(( $(wc -c < "$RUN/body") )) QUERY_STRING="a=$2" busybox ash "$RUN/hb" < "$RUN/body" 2>&1 \
		| tr -d '\r' | sed '1,/^$/d'
}
w() { uci show wireless | grep -E "^wireless\.[^.]+(=|\.(device|disabled|ssid|encryption|key|macaddr|bssid|country|ifname|mode|network)=)"; }

echo "### uci-defaults"; busybox ash "$RUN/defaults.sh"; echo "exit=$?"
uci show network | grep -E 'lan.ipaddr|wwan'; uci show firewall | grep network; uci show dhcp | grep rebind; uci show system | grep hostname
echo; echo "### ensure-wifi (1st)"; busybox ash "$RUN/ensure-wifi"; echo "exit=$?"; w
echo; echo "### ensure-wifi (2nd, must be a no-op)"; : > "$RUN/calls"; busybox ash "$RUN/ensure-wifi"; echo "exit=$? wifi-calls: $(grep -c reload "$RUN/calls")"
echo; echo "### status"; cgi GET status "" | tee "$RUN/status.json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("valid JSON; client_mac", d["client_mac"], "radios", [(r["name"],r["band"],r["country"]) for r in d["radios"]], "setup", d["setup"])'
echo; echo "### connect: bad MAC / multicast MAC / short key"
cgi POST connect '{"radio":"radio1","ssid":"Cafe","encryption":"none","macaddr":"zz:11"}'
cgi POST connect '{"radio":"radio1","ssid":"Cafe","encryption":"none","macaddr":"01:00:5e:00:00:01"}'
cgi POST connect '{"radio":"radio0","ssid":"Cafe","encryption":"psk2","key":"short"}'
cgi POST connect '{"radio":"radio9","ssid":"Cafe","encryption":"none"}'
echo; echo "### connect: open hotspot on 5 GHz with cloned MAC (dash-separated, upper case)"
cgi POST connect '{"radio":"radio1","ssid":"Free \"Town\" WiFi","encryption":"none","key":"ignored","macaddr":"A4-5E-60-12-34-AB","bssid":"aa:bb:cc:dd:ee:ff"}'
sleep 2; w
echo; echo "### ensure-wifi after connect (must not re-enable setup on uplink radio)"; busybox ash "$RUN/ensure-wifi"; w | grep -E 'setup_radio1.disabled|uplink.disabled'
echo; echo "### connect: WPA2 on 2.4 GHz, no MAC"
cgi POST connect '{"radio":"radio0","ssid":"Cafe","encryption":"psk2","key":"password123"}'
w | grep -E 'uplink\.(device|encryption|key|macaddr|bssid)|setup_radio.\.disabled'
echo; echo "### setup network password + country"
cgi POST setup '{"ssid":"MyBridge","key":"supersecret"}'
cgi POST country '{"country":"de"}'
cgi POST country '{"country":"Germany"}'
w | grep -E 'setup_radio0\.(ssid|encryption|key)|country'
echo; echo "### disconnect"; cgi POST disconnect '{}'; w | grep -E 'disabled'
echo; echo "### WPA3 on a build without SAE support"
cgi POST connect '{"radio":"radio0","ssid":"Neighbour","encryption":"sae","key":"password123"}'
echo "### status features"
cgi GET status "" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["features"], "iphone" in d, d["iphone_net"])'
echo; echo "### CSRF: form-encoded POST (what a hostile web page can send)"
printf 'x' > "$RUN/body"
env -i PATH="$PATH" UCI_DIR="$UCI_DIR" REQUEST_METHOD=POST CONTENT_TYPE=application/x-www-form-urlencoded CONTENT_LENGTH=1 HTTP_HOST=192.168.88.1 QUERY_STRING=a=reboot busybox ash "$RUN/hb" < "$RUN/body" | tr -d '\r' | sed -n '1p;$p'
echo "### CSRF: JSON from another origin"
env -i PATH="$PATH" UCI_DIR="$UCI_DIR" REQUEST_METHOD=POST CONTENT_TYPE=application/json CONTENT_LENGTH=1 HTTP_HOST=192.168.88.1 HTTP_ORIGIN=https://evil.example QUERY_STRING=a=reboot busybox ash "$RUN/hb" < "$RUN/body" | tr -d '\r' | sed -n '1p;$p'
echo "### JSON from curl/SSH (no Origin) is allowed"
cgi POST disconnect '{}'
