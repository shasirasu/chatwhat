const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'Client.js');

if (fs.existsSync(clientPath)) {
  let content = fs.readFileSync(clientPath, 'utf8');
  let modified = false;
  let patchCount = 0;

  // Patch window.Debug evaluate loop in inject()
  const targetUnpatched = `            res = await this.pupPage.evaluate(
  // Patch 1: window.Debug evaluate loop in inject()
  // Prevents crashes when page is still navigating
  const target1Unpatched = `            res = await this.pupPage.evaluate(
                'window.Debug?.VERSION != undefined',
            );
            if (res) {
                break;
            }`;

  const replacementPatched = `            try {
  const replacement1Patched = `            try {
                res = await this.pupPage.evaluate(
                    'window.Debug?.VERSION != undefined',
                );
                if (res) {
                    break;
                }
            } catch (err) {
                // Ignore navigation/destruction errors while page loads
            }`;

  if (content.includes(targetUnpatched)) {
    content = content.replace(targetUnpatched, replacementPatched);
    modified = true;
  if (content.includes(target1Unpatched)) {
    content = content.replace(target1Unpatched, replacement1Patched);
    patchCount++;
    console.log('[patch-wwebjs] Applied patch 1: inject() evaluate try-catch');
  }

  if (modified) {
  // Patch 2: framenavigated inject() call
  // Prevents "Navigating frame was detached" from crashing the whole client
  const target2Unpatched = `        this.pupPage.on('framenavigated', async (frame) => {
            if (frame.url().includes('post_logout=1') || this.lastLoggedOut) {
                this.emit(Events.DISCONNECTED, 'LOGOUT');
                await this.authStrategy.logout();
                await this.authStrategy.beforeBrowserInitialized();
                await this.authStrategy.afterBrowserInitialized();
                this.lastLoggedOut = false;
            }
            try {
                await this.inject();
            } catch (err) {
                // Ignore "Navigating frame was detached" and similar transient errors
                if (!err.message || (
                    !err.message.includes('detached') &&
                    !err.message.includes('destroyed') &&
                    !err.message.includes('Target closed') &&
                    !err.message.includes('Session closed')
                )) {
                    throw err;
                }
            }
        });`;

  // This is the previously patched version - check if it's already there
  if (!content.includes(target2Unpatched)) {
    // Try the original (unpatched) form
    const target2Original = `        this.pupPage.on('framenavigated', async (frame) => {
            if (frame.url().includes('post_logout=1') || this.lastLoggedOut) {
                this.emit(Events.DISCONNECTED, 'LOGOUT');
                await this.authStrategy.logout();
                await this.authStrategy.beforeBrowserInitialized();
                await this.authStrategy.afterBrowserInitialized();
                this.lastLoggedOut = false;
            }
            await this.inject();
        });`;

    if (content.includes(target2Original)) {
      const replacement2Patched = `        this.pupPage.on('framenavigated', async (frame) => {
            if (frame.url().includes('post_logout=1') || this.lastLoggedOut) {
                this.emit(Events.DISCONNECTED, 'LOGOUT');
                await this.authStrategy.logout();
                await this.authStrategy.beforeBrowserInitialized();
                await this.authStrategy.afterBrowserInitialized();
                this.lastLoggedOut = false;
            }
            try {
                await this.inject();
            } catch (err) {
                // Ignore "Navigating frame was detached" and similar transient errors
                if (!err.message || (
                    !err.message.includes('detached') &&
                    !err.message.includes('destroyed') &&
                    !err.message.includes('Target closed') &&
                    !err.message.includes('Session closed')
                )) {
                    throw err;
                }
            }
        });`;
      content = content.replace(target2Original, replacement2Patched);
      patchCount++;
      console.log('[patch-wwebjs] Applied patch 2: framenavigated inject() try-catch');
    }
  } else {
    console.log('[patch-wwebjs] Patch 2 already applied');
  }

  // Patch 3: initial await this.inject() in initialize()
  // This is the main source of "Navigating frame was detached" - wrap with retry logic
  const target3Unpatched = `        await page.goto(WhatsWebURL, {
            waitUntil: 'load',
            timeout: 0,
            referer: 'https://whatsapp.com/',
        });

        await this.inject();`;

  const replacement3Patched = `        await page.goto(WhatsWebURL, {
            waitUntil: 'load',
            timeout: 0,
            referer: 'https://whatsapp.com/',
        });

        // Retry inject() up to 3 times to handle transient frame detach errors
        let injectAttempt = 0;
        while (true) {
            try {
                await this.inject();
                break;
            } catch (err) {
                injectAttempt++;
                const isTransient = err && (
                    String(err).includes('detached') ||
                    String(err).includes('destroyed') ||
                    String(err).includes('Target closed') ||
                    String(err).includes('Session closed') ||
                    String(err).includes('auth timeout')
                );
                if (isTransient && injectAttempt < 3) {
                    console.warn('[patch-wwebjs] inject() attempt', injectAttempt, 'failed (transient), retrying...');
                    await new Promise(r => setTimeout(r, 1500));
                    continue;
                }
                throw err;
            }
        }`;

  if (content.includes(target3Unpatched)) {
    content = content.replace(target3Unpatched, replacement3Patched);
    patchCount++;
    console.log('[patch-wwebjs] Applied patch 3: initialize() inject() retry loop');
  }

  if (patchCount > 0) {
    fs.writeFileSync(clientPath, content, 'utf8');
    console.log('[patch-wwebjs] Successfully patched whatsapp-web.js Client.js');
    console.log(`[patch-wwebjs] Successfully applied ${patchCount} patch(es) to Client.js`);
  } else {
    console.log('[patch-wwebjs] whatsapp-web.js is already patched or up to date');
  }
} else {
  console.log('[patch-wwebjs] whatsapp-web.js not found in node_modules');
}

