/* Reproducible, read-only browser smoke: real prices, synthetic markers, no account or secrets. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node verify-tradex-frame.mjs path/to/chart-build [screenshot.png]');
const chartOrigin = 'https://chart.wavekb.test';
const parentOrigin = 'https://app.wavekb.test';

async function run() {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 840 }, colorScheme: 'light' });
    const errors = [];
    let wire;
    let connectionCount = 0;
    await page.routeWebSocket('wss://fstream.binance.com/market/ws/**', (socket) => {
      socket.connectToServer();
      wire = socket;
      connectionCount++;
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${chartOrigin}/**`, (route) => route.fulfill({ path: path.join(directory, new URL(route.request().url()).pathname) }));
    await page.route(`${parentOrigin}/`, (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <iframe title="trade" style="width:100%;height:780px;border:0" sandbox="allow-scripts allow-same-origin" src="${chartOrigin}/wavekb-market.html"></iframe>
      <script>
        const frame=document.querySelector('iframe'), origin='${chartOrigin}', session=crypto.randomUUID();
        const send=(type,fields)=>frame.contentWindow.postMessage({v:1,type,session,...fields},origin);
        frame.onload=()=>send('probe',{});
        window.addEventListener('message',(event)=>{
          if(event.source!==frame.contentWindow||event.origin!==origin||event.data.session!==session)return;
          const m=event.data;
          if(m.type==='ready') {
            document.body.dataset.ready='yes';
            send('initialize',{epoch:m.epoch,lockSymbol:true,market:{provider:'binance',product:'usdt_perpetual',symbol:'BTCUSDT',timeframe:'1m'}});
          } else if(m.type==='marker-selected') document.body.dataset.selected=m.marker;
        });
        window.sendFills=(markers)=>send('set-markers',{markers});
      </script>` }));
    await page.goto(`${parentOrigin}/`);
    await page.waitForFunction(() => document.body.dataset.ready === 'yes');
    const frame = page.frame({ url: /chart\.wavekb\.test/ });
    assert.ok(frame);
    await frame.waitForFunction(() => document.querySelector('#market-status').dataset.state === 'live', null, { timeout: 25000 });
    const tick = await frame.locator('#market-latest').evaluate((el) => ({ time: Number(el.dataset.candleTime), price: Number(el.textContent.replaceAll(',', '').split(' ')[0]) }));
    await page.evaluate(({ time, price }) => window.sendFills([
      { marker: 'm1', timestamp: new Date(time * 1000 + 1000).toISOString(), price: (price - 15).toFixed(2), role: 'open' },
      { marker: 'm2', timestamp: new Date(time * 1000 + 5000).toISOString(), price: (price + 15).toFixed(2), role: 'close' },
    ]), tick);

    const picks = await frame.waitForFunction(() => {
      const colors = [[63, 111, 159], [169, 71, 112]], found = [];
      for (const canvas of document.querySelectorAll('canvas')) {
        const context = canvas.getContext('2d');
        if (!context || !canvas.width || !canvas.height) continue;
        const bits = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const sums = colors.map(() => ({ x: 0, y: 0, count: 0 }));
        for (let i = 0; i < bits.length; i += 4) {
          if (bits[i + 3] !== 255) continue;
          for (let j = 0; j < colors.length; j++) {
            const c = colors[j];
            if (bits[i] === c[0] && bits[i + 1] === c[1] && bits[i + 2] === c[2]) {
              sums[j].count++; sums[j].x += (i / 4) % canvas.width; sums[j].y += Math.floor(i / 4 / canvas.width);
            }
          }
        }
        if (!sums.every((sum) => sum.count)) continue;
        const box = canvas.getBoundingClientRect();
        for (const sum of sums) found.push({ x: box.left + sum.x / sum.count * box.width / canvas.width, y: box.top + sum.y / sum.count * box.height / canvas.height });
        return found;
      }
      return false;
    }, null, { timeout: 9500 }).then((handle) => handle.jsonValue());
    if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
    const pos = await page.locator('iframe').boundingBox();
    for (let index = 0; index < picks.length; index++) {
      await page.mouse.click(pos.x + picks[index].x, pos.y + picks[index].y);
      await page.waitForFunction((id) => document.body.dataset.selected === id, `m${index + 1}`, { timeout: 4000 });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      await frame.waitForFunction(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, null, { timeout: 2500 });
    } catch (error) {
      console.error('Mobile layout:', await frame.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll('*')].map((el) => [el.tagName, String(el.className), el.getBoundingClientRect().right])
          .filter((item) => item[2] > innerWidth + 1).slice(0, 12) })));
      throw error;
    }
    assert.deepEqual(errors, []);
    console.log('Binance live; both same-candle synthetic fills drawn and selected; mobile width fits.');
    if (process.env.TRADING_TEST_RECONNECT === '1') {
      const first = connectionCount;
      const event = await frame.locator('#market-latest').getAttribute('data-event-time');
      await wire.close({ code: 1001, reason: 'Browser smoke interruption' });
      await frame.waitForFunction((previous) => document.querySelector('#market-status').dataset.state === 'live'
        && Number(document.querySelector('#market-latest').dataset.eventTime) > Number(previous), event, { timeout: 25_000 });
      assert.ok(connectionCount > first);
      console.log('Forced WebSocket close recovered to a fresh confirmed Binance frame.');
    }
  } finally { await browser.close(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
