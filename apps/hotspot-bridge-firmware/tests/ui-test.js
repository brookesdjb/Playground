const { chromium } = require('playwright');
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '../files/www/hb/index.html'), 'utf8');
const status = {ok:true,hostname:'hotspotbridge',release:'OpenWrt 25.12.6',lan_ip:'192.168.88.1',client_ip:'192.168.88.170',client_mac:'aa:bb:cc:00:11:22',
 uplink:{enabled:true,radio:'radio0',ssid:'Town Free WiFi',bssid:'',encryption:'none',macaddr:'a4:5e:60:12:34:ab',actual_mac:'a4:5e:60:12:34:ab'},
 setup:{ssid:'HotspotBridge-B99B',secured:false},
 radios:[{name:'radio0',band:'2g',channel:'auto',country:'GB',phy_mac:'40:ed:00:cf:b9:9b'},{name:'radio1',band:'5g',channel:'36',country:'GB',phy_mac:'40:ed:00:cf:b9:9a'}],
 wwan:{up:true,'ipv4-address':[{address:'10.20.31.44',mask:22}],route:[{target:'0.0.0.0',mask:0,nexthop:'10.20.28.1'}]},
 sta:{ssid:'Town Free WiFi',signal:-67,channel:6}};
const scan = {ok:true,radio:'radio0',scan:{results:[
 {ssid:'Town Free WiFi',bssid:'aa:bb:cc:dd:ee:01',channel:6,signal:-67,encryption:{enabled:false}},
 {ssid:'BT-Home-1234',bssid:'aa:bb:cc:dd:ee:02',channel:1,signal:-80,encryption:{enabled:true,wpa:[2],authentication:['psk'],ciphers:['ccmp']}},
 {ssid:'eduroam',bssid:'aa:bb:cc:dd:ee:03',channel:11,signal:-75,encryption:{enabled:true,wpa:[2],authentication:['802.1x']}},
 {ssid:'Neighbour WPA3',bssid:'aa:bb:cc:dd:ee:04',channel:11,signal:-71,encryption:{enabled:true,wpa:[3],authentication:['sae']}}]}};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:420,height:900}, deviceScaleFactor:1});
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  let posted = null;
  await p.route('**/*', async r => {
    const u = r.request().url();
    if (u.endsWith('/hb/')) return r.fulfill({contentType:'text/html', body: html});
    if (u.includes('a=status')) return r.fulfill({json: status});
    if (u.includes('a=scan')) return r.fulfill({json: scan});
    if (u.includes('a=check')) return r.fulfill({json:{ok:true,ping:true,http:'HTTP/1.1 302',verdict:'captive'}});
    if (u.includes('a=connect')) { posted = {body: r.request().postData(), hdr: r.request().headers()['x-hb']}; return r.fulfill({json:{ok:true,message:'Connecting'}}); }
    r.fulfill({status:404, body:''});
  });
  await p.goto('http://router.test/hb/'); await p.waitForTimeout(500);
  await p.click('#b-scan'); await p.waitForTimeout(300);
  await p.click('td:text-is("Neighbour WPA3")'); 
  console.log('enc after WPA3 pick:', await p.inputValue('#c-enc'));
  await p.click('td:text-is("eduroam")'); console.log('hint:', await p.textContent('#scan-hint'));
  await p.click('td:text-is("Town Free WiFi")'); console.log('enc after open pick:', await p.inputValue('#c-enc'));
  await p.click('#b-check'); await p.waitForTimeout(200);
  await p.click('#b-conn'); await p.waitForTimeout(300);
  console.log('posted:', JSON.stringify(posted));
  console.log('status rows:', (await p.textContent('.kv')).replace(/\s+/g,' ').trim());
  await p.screenshot({path: process.argv[2] || 'ui.png', fullPage: true});
  console.log('errors:', errs);
  await b.close();
})();
