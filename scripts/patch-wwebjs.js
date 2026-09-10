const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'Client.js');

if (fs.existsSync(clientPath)) {
  let content = fs.readFileSync(clientPath, 'utf8');
  let modified = false;

  // Patch window.Debug evaluate loop in inject()
  const targetUnpatched = `            res = await this.pupPage.evaluate(
                'window.Debug?.VERSION != undefined',
            );
            if (res) {
                break;
            }`;

  const replacementPatched = `            try {
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
  }

  if (modified) {
    fs.writeFileSync(clientPath, content, 'utf8');
    console.log('[patch-wwebjs] Successfully patched whatsapp-web.js Client.js');
  } else {
    console.log('[patch-wwebjs] whatsapp-web.js is already patched or up to date');
  }
} else {
  console.log('[patch-wwebjs] whatsapp-web.js not found in node_modules');
}
