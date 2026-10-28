import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = 0;

function check(condition, message) {
  if (!condition) {
    failed += 1;
    console.error(message);
  }
}

function readJson(relative) {
  const text = readFileSync(path.join(root, relative), 'utf8');
  check(!text.startsWith('\uFEFF'), `${relative} must be UTF-8 without a BOM`);
  return JSON.parse(text);
}

const pkg = readJson('package.json');
const plugin = readJson('.minimax-plugin/plugin.json');
const mini = readJson('miniapp/miniapp.json');
const mcp = readJson('radviewer.mcp.json');
const portable = readJson('chatgpt/plugin.json');
const portableMcp = readJson('chatgpt/mcp.json');
const zcode = readJson('.zcode-plugin/plugin.json');
const zcodeMcp = readJson('.mcp.json');
const zcodeMarket = readJson('marketplace.json');
const chatgptMarket = readJson('.agents/plugins/marketplace.json');

check(plugin.schemaVersion === 1, 'plugin schemaVersion');
check(pkg.name === 'radviewer', 'package name');
check(plugin.name === 'radviewer', 'plugin name');
check(plugin.version === pkg.version, 'plugin version must match package.json');
check(plugin.displayName === 'RadViewer', 'displayName');
check(plugin.category === 'Science & Healthcare', 'category');
check(plugin.icon === 'icon.png', 'icon path');
check(Array.isArray(plugin.apps) && plugin.apps.length === 0, 'apps stay empty');
check(plugin.mcpServers.length === 1 && plugin.mcpServers[0] === 'radviewer.mcp.json', 'mcpServers');
check(plugin.skills.length === 1 && plugin.skills[0] === 'skills/radviewer/SKILL.md', 'skills');
check(plugin.exampleQueries.length >= 1 && plugin.exampleQueries.length <= 3, 'exampleQueries');
check(!('darkIcon' in plugin), 'omit darkIcon');
check(!('hooks' in plugin), 'omit hooks');
check(!('preinstall' in (pkg.scripts ?? {})), 'no preinstall');
check(!('install' in (pkg.scripts ?? {})), 'no install');
check(!('postinstall' in (pkg.scripts ?? {})), 'no postinstall');
check(pkg.mcode?.schemaVersion === 2, 'mcode schemaVersion');
check(pkg.mcode?.miniApp === './miniapp/miniapp.json', 'mcode miniApp');

check(mini.schemaVersion === 1, 'miniapp schemaVersion');
check(mini.runtime?.kind === 'process', 'runtime kind');
check(mini.runtime?.entry === './miniapp/node/server.mjs', 'runtime entry');
check(mini.runtime?.lifecycle === 'on-demand', 'lifecycle');
check(mini.surface?.path === '/radviewer', 'surface path');
check(mini.mcpEndpoints?.length === 1, 'mcp endpoint');
check(mini.mcpEndpoints?.[0]?.server === 'radviewer', 'mcp endpoint server');
check(mini.mcpEndpoints?.[0]?.path === '/mcp/radviewer', 'mcp endpoint path');

const server = mcp.mcpServers?.radviewer;
check(mcp.schemaVersion === 1, 'mcp schemaVersion');
check(server?.type === 'streamable-http', 'mcp transport');
check(server?.url === 'http://127.0.0.1:9/mcp/radviewer', 'mcp placeholder url');
check(!server?.command, 'managed mcp has no command');

check(portable.$schema === 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', 'portable plugin schema');
check(portable.name === 'radviewer', 'portable plugin name');
check(portable.version === pkg.version, 'portable plugin version');
check(portableMcp.$schema === 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', 'portable mcp schema');
check(portableMcp.mcpServers?.radviewer?.type === 'stdio', 'portable mcp transport');
check(portableMcp.mcpServers?.radviewer?.command === 'node', 'portable mcp command');
check(portableMcp.mcpServers?.radviewer?.args?.[0] === '${PLUGIN_ROOT}/stdio.mjs', 'portable mcp args');
check(portable.extensions?.['com.openai']?.requires_local_executor === true, 'desktop execution required');
check(readFileSync('chatgpt/stdio.mjs', 'utf8').includes('./miniapp/node/stdio.mjs'), 'portable stdio entry');
check(readFileSync('chatgpt/skills/radviewer/SKILL.md', 'utf8') === readFileSync('skills/radviewer/SKILL.md', 'utf8'), 'chatgpt skill matches');
check(statSync(path.join(root, 'plugin.json'), { throwIfNoEntry: false }) == null, 'root plugin.json would hide the Mini App');
check(statSync(path.join(root, 'mcp.json'), { throwIfNoEntry: false }) == null, 'root mcp.json would hide the Mini App');

check(zcode.name === 'radviewer', 'zcode plugin name');
check(zcode.version === pkg.version, 'zcode version');
check(zcode.mcpServers === '.mcp.json', 'zcode mcp file');
check(zcode.ui?.surfaces?.[0]?.id === 'radviewer', 'zcode surface id');
check(zcode.ui?.surfaces?.[0]?.server === 'radviewer', 'zcode surface server');
check(zcode.ui?.surfaces?.[0]?.resourceUri === 'ui://radviewer/viewer.html', 'zcode surface resource');
check(zcode.ui?.surfaces?.[0]?.availability === 'session', 'zcode session sidebar');
check(zcodeMcp.mcpServers?.radviewer?.command === 'node', 'zcode mcp command');
check(zcodeMcp.mcpServers?.radviewer?.args?.[0] === '${CLAUDE_PLUGIN_ROOT}/miniapp/node/stdio.mjs', 'zcode mcp args');
check(zcodeMarket.name === 'radviewer', 'zcode marketplace name');
check(zcodeMarket.plugins?.[0]?.name === 'radviewer' && zcodeMarket.plugins?.[0]?.source === './', 'zcode marketplace source');
check(zcodeMarket.plugins?.[0]?.version === pkg.version, 'zcode marketplace version');
check(chatgptMarket.interface?.displayName === 'RadViewer', 'chatgpt marketplace title');
check(chatgptMarket.plugins?.[0]?.source?.path === './chatgpt', 'chatgpt marketplace source');
check(chatgptMarket.plugins?.[0]?.policy?.installation === 'AVAILABLE', 'chatgpt installation policy');
check(statSync(path.join(root, 'medview.mcp.json'), { throwIfNoEntry: false }) == null, 'old medview mcp is gone');
check(statSync(path.join(root, 'skills/medview/SKILL.md'), { throwIfNoEntry: false }) == null, 'old medview skill is gone');

const skill = readFileSync('skills/radviewer/SKILL.md', 'utf8');
check(skill.startsWith('---\nname: radviewer\n'), 'skill name matches the directory');
check(/^description: \S/m.test(skill), 'skill description');
const bridge = readFileSync('miniapp/node/viewer-bridge.js', 'utf8');
check(bridge.includes(`version: '${pkg.version}'`), 'bridge version');
check(bridge.includes('__radviewerInlineWorker'), 'bridge inline worker');
check(readFileSync('src/createWorker.ts', 'utf8').includes('__radviewerInlineWorker'), 'worker fallback');
check(readFileSync('miniapp/node/mcp.mjs', 'utf8').includes(`version: '${pkg.version}'`), 'mcp server version');
check(readFileSync('miniapp/client/app.js', 'utf8').includes('__radviewerInlineWorker'), 'built worker fallback');

for (const relative of ['node/stdio.mjs', 'node/mcp.mjs', 'node/tools.mjs', 'node/panel.mjs', 'node/viewer-bridge.js', 'node/files.mjs', 'node/catalog.mjs', 'node/open.mjs', 'node/server.mjs', 'client/app.js', 'client/app.css', 'client/index.html']) {
  check(readFileSync('miniapp/' + relative).equals(readFileSync('chatgpt/miniapp/' + relative)), 'stale ChatGPT runtime: ' + relative);
}
check(readFileSync('LICENSE').equals(readFileSync('chatgpt/LICENSE')), 'ChatGPT license');
const icon = readFileSync('icon.png');
check(icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'icon.png signature');

for (const relative of ['miniapp/client/index.html', 'miniapp/client/app.js', 'miniapp/client/app.css', 'miniapp/node/server.mjs', 'miniapp/node/stdio.mjs']) {
  check(statSync(path.join(root, relative), { throwIfNoEntry: false })?.isFile(), `missing ${relative}`);
}
check(readFileSync('miniapp/client/index.html', 'utf8').includes('/radviewer/app.js'), 'built page route');

const skip = new Set(['.git', 'node_modules', 'dist', 'samples', '.vite']);
const nameOk = /^[A-Za-z0-9._-]+$/;

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    check(nameOk.test(entry.name), `file name must be ASCII letters, digits, dot, underscore, or hyphen: ${entry.name}`);
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) check(false, `symlink is not allowed: ${full}`);
    else if (entry.isDirectory()) walk(full);
  }
}

walk(root);

if (failed > 0) {
  console.error(`package check failed (${failed})`);
  process.exit(1);
}
console.log('package check ok');
