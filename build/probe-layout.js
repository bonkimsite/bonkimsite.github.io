'use strict';

// Compare layout geometry between the original Cargo page and the static
// rebuild. This talks directly to an installed Chrome over the DevTools
// Protocol, keeping the project free of browser-automation dependencies.

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_ORIGINAL = 'https://bon.kim/a-man-with-three-legs';
const DEFAULT_REBUILD = 'https://bonkimsite.github.io/work/a-man-with-three-legs/';
const DEFAULT_VIEWPORT = { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false };

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    process.platform === 'linux' && '/usr/bin/google-chrome',
    process.platform === 'linux' && '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Chrome was not found. Set CHROME_PATH to its executable.');
  }
  return found;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFile(filename, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filename)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${filename}`);
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const queue = this.listeners.get(message.method);
      if (queue && queue.length) queue.shift()(message.params);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  once(method) {
    return new Promise(resolve => {
      const queue = this.listeners.get(method) || [];
      queue.push(resolve);
      this.listeners.set(method, queue);
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForTarget(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const page = targets.find(target => target.type === 'page');
      if (page) return page;
    } catch {
      // Chrome may have written DevToolsActivePort before the endpoint is ready.
    }
    await delay(50);
  }
  throw new Error('Timed out waiting for a Chrome page target');
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Evaluation failed');
  }
  return result.result.value;
}

async function loadPage(client, url) {
  const loaded = client.once('Page.loadEventFired');
  const navigation = await client.send('Page.navigate', { url });
  if (navigation.errorText) throw new Error(`${url}: ${navigation.errorText}`);
  await loaded;

  await evaluate(client, String.raw`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const deepElements = (root = document) => {
      const found = [];
      const visit = node => {
        for (const child of node.children || []) {
          found.push(child);
          visit(child);
          if (child.shadowRoot) visit(child.shadowRoot);
        }
      };
      visit(root);
      return found;
    };

    if (document.fonts) await document.fonts.ready;

    // Trigger lazy media and give Cargo's custom elements time to settle. The
    // document can grow while scrolling, so read scrollHeight every iteration.
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.8) {
      scrollTo(0, y);
      await wait(60);
    }
    scrollTo(0, document.documentElement.scrollHeight);
    await wait(250);

    const images = deepElements().filter(element => element.tagName === 'IMG');
    await Promise.all(images.map(image => {
      if (image.complete) return image.decode ? image.decode().catch(() => {}) : undefined;
      return new Promise(resolve => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
    }));
    if (document.fonts) await document.fonts.ready;
    scrollTo(0, 0);
    await wait(250);
  })()`, true);
}

const MEASURE_EXPRESSION = String.raw`(() => {
  const round = value => Math.round(value * 1000) / 1000;
  const rect = element => {
    const value = element.getBoundingClientRect();
    return {
      x: round(value.x + scrollX),
      y: round(value.y + scrollY),
      width: round(value.width),
      height: round(value.height),
      bottom: round(value.bottom + scrollY),
    };
  };
  const style = element => {
    const value = getComputedStyle(element);
    return {
      display: value.display,
      position: value.position,
      fontSize: value.fontSize,
      lineHeight: value.lineHeight,
      verticalAlign: value.verticalAlign,
      marginTop: value.marginTop,
      marginBottom: value.marginBottom,
      paddingTop: value.paddingTop,
      paddingBottom: value.paddingBottom,
      gap: value.gap,
    };
  };
  const deepElements = (root = document) => {
    const found = [];
    const visit = node => {
      for (const child of node.children || []) {
        found.push(child);
        visit(child);
        if (child.shadowRoot) visit(child.shadowRoot);
      }
    };
    visit(root);
    return found;
  };
  const all = deepElements();
  const matches = selector => all.filter(element => element.matches?.(selector));
  const cleanText = element => (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const describe = element => ({
    tag: element.tagName.toLowerCase(),
    className: typeof element.className === 'string' ? element.className : '',
    hash: element.getAttribute('hash') || '',
    src: element.currentSrc || element.getAttribute('src') || '',
    text: cleanText(element),
    rect: rect(element),
    style: style(element),
  });

  const headings = matches('h1');
  const pageTitle = headings.find(heading => /three legs/i.test(cleanText(heading))) || headings.at(-1);
  const columnSets = matches('column-set, .column-set').map(set => ({
    ...describe(set),
    units: [...set.children]
      .filter(child => child.matches('column-unit, .column-unit'))
      .map(describe),
  }));

  return {
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    environment: {
      devicePixelRatio,
      visualViewportScale: visualViewport?.scale,
      screenWidth: screen.width,
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      baseSize: getComputedStyle(document.documentElement).getPropertyValue('--base-size').trim(),
      htmlStyle: document.documentElement.getAttribute('style') || '',
      bodyClass: document.body.className,
    },
    documentHeight: round(document.documentElement.scrollHeight),
    shell: matches('html, body, bodycopy, .page-layout, .page-content, main, article.page').map(describe),
    pageTitle: pageTitle ? describe(pageTitle) : null,
    columnSets,
    media: matches('media-item, figure.media-item').map(describe),
    images: matches('img').filter(image => !image.closest('.backdrop')).map(describe),
    bodyText: matches('.bodyoftextlight').map(describe),
    reading: matches('.reading, .reading-text').map(describe),
    captions: matches('.caption').map(describe),
    breaks: matches('br').map(describe),
  };
})()`;

function relativeTop(item, page) {
  return item.rect.y - (page.pageTitle?.rect.bottom || 0);
}

function printComparison(original, rebuild, key) {
  const left = original[key];
  const right = rebuild[key];
  const count = Math.max(left.length, right.length);
  console.log(`\n${key} (${left.length} original / ${right.length} rebuild)`);
  console.log(' #   original y/h    rebuild y/h     relative drift   identifier');
  for (let index = 0; index < count; index++) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) {
      console.log(`${String(index + 1).padStart(2)}   ${a ? 'original only' : 'rebuild only'}`);
      continue;
    }
    const drift = relativeTop(b, rebuild) - relativeTop(a, original);
    const identifier = (a.hash || path.basename(new URL(a.src || 'file:///unknown').pathname) || a.text)
      .slice(0, 34);
    console.log(
      `${String(index + 1).padStart(2)}  ` +
      `${a.rect.y.toFixed(1).padStart(7)}/${a.rect.height.toFixed(1).padEnd(7)} ` +
      `${b.rect.y.toFixed(1).padStart(7)}/${b.rect.height.toFixed(1).padEnd(7)} ` +
      `${drift.toFixed(1).padStart(9)}px      ${identifier}`
    );
  }
}

async function main() {
  const originalUrl = process.argv[2] || DEFAULT_ORIGINAL;
  const rebuildUrl = process.argv[3] || DEFAULT_REBUILD;
  const jsonOutput = process.argv[4] || process.env.PROBE_JSON;
  const viewport = {
    ...DEFAULT_VIEWPORT,
    width: Number.parseInt(process.argv[5], 10) || DEFAULT_VIEWPORT.width,
  };
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bon-layout-'));
  const activePort = path.join(profile, 'DevToolsActivePort');
  const chrome = childProcess.spawn(chromePath(), [
    '--headless=new',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--hide-scrollbars',
    '--no-first-run',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeErrors = '';
  chrome.stderr.on('data', chunk => { chromeErrors += chunk; });

  try {
    await waitForFile(activePort);
    const [port] = fs.readFileSync(activePort, 'utf8').split(/\r?\n/);
    const target = await waitForTarget(port);
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', viewport);

    console.log(`Loading original: ${originalUrl}`);
    await loadPage(client, originalUrl);
    const original = await evaluate(client, MEASURE_EXPRESSION);

    console.log(`Loading rebuild:  ${rebuildUrl}`);
    await loadPage(client, rebuildUrl);
    const rebuild = await evaluate(client, MEASURE_EXPRESSION);

    console.log('\nSummary');
    console.log(`  original environment:  ${JSON.stringify(original.environment)}`);
    console.log(`  rebuild environment:   ${JSON.stringify(rebuild.environment)}`);
    console.log(`  original title:        ${JSON.stringify(original.pageTitle?.rect)}`);
    console.log(`  rebuild title:         ${JSON.stringify(rebuild.pageTitle?.rect)}`);
    console.log(`  original document:     ${original.documentHeight}px`);
    console.log(`  rebuild document:      ${rebuild.documentHeight}px`);
    printComparison(original, rebuild, 'columnSets');
    printComparison(original, rebuild, 'media');
    printComparison(original, rebuild, 'images');

    if (jsonOutput) {
      fs.mkdirSync(path.dirname(jsonOutput), { recursive: true });
      fs.writeFileSync(jsonOutput, JSON.stringify({ original, rebuild }, null, 2));
      console.log(`\nWrote full measurements to ${jsonOutput}`);
    }
    client.close();
  } catch (error) {
    if (chromeErrors.trim()) console.error(chromeErrors.trim());
    throw error;
  } finally {
    if (chrome.exitCode === null) {
      const exited = new Promise(resolve => chrome.once('exit', resolve));
      chrome.kill();
      await Promise.race([exited, delay(3000)]);
    }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
