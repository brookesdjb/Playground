#!/bin/bash
# Host-side test of the CGI's firmware validation using busybox + stubs.
HERE=$(cd "$(dirname "$0")" && pwd)
F=$HERE/../files
TMPROOT=${TMPROOT:-$HERE/../.work/tests}
mkdir -p "$TMPROOT"
T=$TMPROOT/restore
mkdir -p "$T/bin" "$T/tmp"

cat > "$T/jshn.sh" <<'E'
json_init(){ J=""; }
json_add_boolean(){ J="$J,\"$1\":$([ "$2" = 1 ] && echo true || echo false)"; }
json_add_string(){ J="$J,$(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()),end="")'):$(printf '%s' "$2" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()),end="")')"; }
json_dump(){ echo "{ ${J#,} }"; }
E
printf '#!/bin/sh\necho "$@" > %s/sysupgrade.args\n' "$T" > "$T/bin/sysupgrade"
chmod +x "$T/bin/sysupgrade"
for a in hexdump dd wc head tail tr sed grep rm sync awk setsid cut sh sleep stat env busybox; do ln -sf /usr/bin/busybox "$T/bin/$a"; done
ln -sf "$(command -v python3)" "$T/bin/python3"
sed -e "s#/usr/share/libubox/jshn.sh#$T/jshn.sh#; s#/tmp/hb-#$T/tmp/hb-#g; s#/sbin/sysupgrade#$T/bin/sysupgrade#g" \
	"$F/www/cgi-bin/hb" > "$T/hb"

run() {
	: > "$T/sysupgrade.args"
	local sz; sz=$(stat -c %s "$1")
	env -i PATH="$T/bin" REQUEST_METHOD=POST CONTENT_TYPE=application/octet-stream HTTP_HOST=192.168.88.1 HTTP_ORIGIN=http://192.168.88.1 CONTENT_LENGTH="$sz" QUERY_STRING="a=$2" \
		busybox ash "$T/hb" < "$1" 2>/dev/null | tr -d '\r' | sed -n '1p;$p'
	sleep 4
	if [ -s "$T/sysupgrade.args" ]; then
		echo "  -> sysupgrade $(cat "$T/sysupgrade.args")"
		echo "  -> staged sha256 $(sha256sum "$T/tmp/hb-flash.bin" | cut -c1-16)"
	else
		echo "  -> nothing flashed"
	fi
	echo
}

O=${OUT:-$HERE/../out}; S=${EXTRA_STOCK_DIR:-/nonexistent}
echo "expected stripped stock sha256: $(sha256sum "$O/restore-stock/stock-firmware-part.bin" | cut -c1-16)"
echo
# EXTRA_STOCK_DIR may hold other TP-Link .bin files (e.g. the encrypted 0.9.3
# release, which must be refused).
for f in "$O/restore-stock/TL-WR902ACv4_EU_0.9.1_stock-original.bin" \
	"$O/restore-stock/via-tftp/tp_recovery.bin" \
	"$O/restore-stock/stock-firmware-part.bin" \
	"$S"/*.bin \
	"$O"/standard/install-via-tftp/tp_recovery.bin \
	"$O"/standard/hotspotbridge-standard-sysupgrade.bin; do
	[ -f "$f" ] || continue
	echo "== $(basename "$f")"
	run "$f" restore_stock
done

echo "== POST with a form Content-Type (cross-site)"
env -i PATH="$T/bin" REQUEST_METHOD=POST CONTENT_LENGTH=0 QUERY_STRING=a=reboot busybox ash "$T/hb" </dev/null | tr -d '\r'
echo "== GET on a POST action"
env -i PATH="$T/bin" REQUEST_METHOD=GET QUERY_STRING='a=connect' busybox ash "$T/hb" </dev/null | tr -d '\r'
