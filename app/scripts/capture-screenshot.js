#!/usr/bin/env node
'use strict';

// THE README SCREENSHOT, from FIXTURE data rather than the real corpus.
//
// The end-to-end gate already takes screenshots, and not one of them can be
// published: it drives the real `~/.claude/projects`, so every capture carries
// real project names, real client names and, in at least one case, real PHI.
// This script builds a small synthetic corpus in a temp directory, points a
// fully isolated Harbor at it, opens two conversation windows, and captures
// that. Nothing it renders exists outside the run.
//
//   env -u DISPLAY -u WAYLAND_DISPLAY node scripts/capture-screenshot.js
//
// Writes docs/screenshot.png. Runs under xvfb by default, on purpose: a window
// that opens on the real desktop steals focus from whatever is there.
//
// TWO THINGS THIS SCRIPT EXISTS TO REMEMBER, both of which cost a capture.
//
// 1. THE CORPUS MUST NOT LIVE UNDER A TEMP ROOT. For a long time the rail came
//    up EMPTY here while the conversation windows rendered from the same corpus
//    perfectly, which looked like an indexing bug and is not one. The corpus was
//    built under os.tmpdir(), and `isScratchSession` in shared/sidebar-model
//    deliberately hides any session whose cwd matches TEMP_ROOT_RE, because a
//    throwaway directory is not a project. The app was right; the harness had
//    picked exactly the path the app is designed to hide, so the rail correctly
//    refused to list its own fixtures. The root is therefore app/verify/shot
//    (gitignored) rather than a temp dir. If the rail ever comes up empty again,
//    check what isScratchProject makes of the cwd before suspecting the index.
//
// 2. ISOLATING HOME IS REQUIRED. `provider-history.js` scans ~/.codex/sessions
//    and ~/.cursor/projects from os.homedir(), so with `paths.projectsDir`
//    pointed at the fixture corpus the rail STILL filled with the real machine's
//    projects, including real client names. Same shape as the isolation
//    incidents this repo already carries: isolating the parts you thought of is
//    not isolation.
//
// Every capture must still be LOOKED AT before it is published. A grep cannot
// read a PNG, which is how a screenshot carrying a real employer department and
// a real internal project name survived every text sweep and shipped.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const OUT = path.join(REPO_ROOT, 'docs', 'screenshot.png');
const SHOT_DIR = path.join(REPO_ROOT, 'docs', 'screenshots');

// Re-exec under a scrubbed X server unless we are already inside one, or the
// caller has explicitly asked to watch it.
if (!process.env.HARBOR_SHOT_INNER && !process.env.HARBOR_SHOT_HEADED) {
  const result = spawnSync(
    'env',
    ['-u', 'DISPLAY', '-u', 'WAYLAND_DISPLAY', 'xvfb-run', '-a',
      '--server-args=-screen 0 1600x1000x24',
      process.execPath, __filename],
    { stdio: 'inherit', env: { ...process.env, HARBOR_SHOT_INNER: '1' }, cwd: APP_ROOT },
  );
  process.exit(result.status ?? 1);
}

// A neutral corpus: ordinary-looking open-source work, no real anything.
const SESSIONS = [
  {
    project: 'harbor', dir: 'demo/harbor', title: 'Wire the release workflow',
    blocks: [
      ['user', 'The tagged build produces installers but nothing publishes them. Wire the release step and tell me what it will and will not do.'],
      ['assistant', 'The workflow builds on all three runners and uploads to the run\'s artifact tab, which is not a distribution channel: downloading one means knowing a tag was pushed, finding the run, and being signed in.\n\nI have attached the installers to a draft release instead, so a maintainer publishes deliberately. Unsigned binaries should not go public on a tag push alone.'],
      ['tool', 'Edit  .github/workflows/build.yml'],
      ['assistant', 'One caveat worth stating in the release notes rather than leaving to be discovered: nothing here is code-signed, so SmartScreen and Gatekeeper will both warn. The steps to accept that are in the notes.'],
    ],
  },
  {
    project: 'notes-api', dir: 'demo/notes-api', title: 'Rate limiter drops the first request',
    blocks: [
      ['user', 'The rate limiter rejects the very first request from a new client. Only sometimes.'],
      ['assistant', 'Reproduced it: the bucket is created with zero tokens and refilled on a timer, so a request arriving before the first tick sees an empty bucket. "Sometimes" is whether you arrive inside the first interval.'],
      ['tool', 'Bash  npm test -- limiter'],
      ['assistant', 'Buckets now start full and refill from there. The test that would have caught it asserts the first request of a brand-new client, which is the case nobody wrote down.'],
    ],
  },
  {
    project: 'notes-api', dir: 'demo/notes-api', title: 'Migrate the fixtures',
    blocks: [
      ['user', 'Move the fixtures off the shared database.'],
      ['assistant', 'Done. Each suite now builds its own, so a run cannot depend on what another one left behind.'],
    ],
  },
  {
    project: 'site', dir: 'demo/site', title: 'Dark mode reads wrong on system default',
    blocks: [
      ['user', 'Dark mode is fine when you pick it, wrong when the OS picks it.'],
      ['assistant', 'The palette only exists inside the media query, so with no explicit choice the tokens fall back to whatever the host paints. Defining the light palette on bare :root and overriding under the query fixes both paths.'],
      ['tool', 'Write  {ARTIFACTS}/palette-preview.html'],
      ['assistant', 'I put a side-by-side of both themes in palette-preview.html so the three states (explicit light, explicit dark, system default) can be compared without toggling the OS.'],
    ],
  },
];

function mungedDir(cwd) {
  return cwd.replace(/[/.]/g, '-');
}

// The Artifacts view is TRANSCRIPT-driven: a file counts when a recent
// transcript names it, it exists, it has a viewable extension, and its mtime is
// not older than the naming session. So the fixture has to do both halves,
// write the file and mention it, or the view is honestly empty.
function buildArtifacts(root) {
  const dir = path.join(root, 'artifacts', 'demo', 'site');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'palette-preview.html'), [
    '<!doctype html><meta charset="utf-8"><title>Palette preview</title>',
    '<style>:root{--bg:#fff;--fg:#111;--card:#f4f4f5}',
    '@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0d0f13;--fg:#e8e8ea;--card:#171a20}}',
    'body{margin:0;font:15px/1.6 system-ui;background:var(--bg);color:var(--fg);padding:40px}',
    '.row{display:flex;gap:16px;margin-top:20px}.sw{flex:1;padding:22px;border-radius:10px;background:var(--card)}',
    '</style><h1>Palette preview</h1><p>Explicit light, explicit dark, and system default.</p>',
    '<div class="row"><div class="sw">Surface</div><div class="sw">Raised</div><div class="sw">Accent</div></div>',
  ].join(''));
  return dir;
}

function buildCorpus(root) {
  const projectsDir = path.join(root, 'projects');
  const home = path.join(root, 'home');
  const artifactsDir = buildArtifacts(root);
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const ids = [];
  SESSIONS.forEach((session, index) => {
    const id = `0000000${index}-1111-4222-8333-44444444444${index}`;
    const cwd = path.join(home, session.dir);
    fs.mkdirSync(cwd, { recursive: true });
    const dir = path.join(projectsDir, mungedDir(cwd));
    fs.mkdirSync(dir, { recursive: true });
    const lines = [];
    lines.push(JSON.stringify({ type: 'summary', summary: session.title, leafUuid: id }));
    session.blocks.forEach(([kind, rawText], n) => {
      const text = rawText.replace('{ARTIFACTS}', artifactsDir);
      const uuid = `${id.slice(0, 30)}${String(n).padStart(6, '0')}`;
      const timestamp = new Date(Date.now() - (SESSIONS.length - index) * 3600_000 + n * 60_000).toISOString();
      if (kind === 'user') {
        lines.push(JSON.stringify({
          type: 'user', uuid, sessionId: id, cwd, timestamp,
          message: { role: 'user', content: [{ type: 'text', text }] },
        }));
      } else if (kind === 'tool') {
        lines.push(JSON.stringify({
          type: 'assistant', uuid, sessionId: id, cwd, timestamp,
          message: {
            role: 'assistant',
            model: 'claude-opus-5',
            content: [{ type: 'tool_use', id: `t-${n}`, name: text.split(/\s+/)[0], input: { file_path: text.split(/\s{2,}/)[1] || '' } }],
          },
        }));
      } else {
        lines.push(JSON.stringify({
          type: 'assistant', uuid, sessionId: id, cwd, timestamp,
          message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text }] },
        }));
      }
    });
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), `${lines.join('\n')}\n`);
    ids.push({ id, project: session.project, cwd });
  });
  return { projectsDir, home, ids };
}

async function main() {
  const { _electron: electron } = require('@playwright/test');
  // NOT os.tmpdir(): see the header. A cwd under a temp root is a scratch
  // session and the rail hides it by design. app/verify/ is gitignored.
  const root = path.join(APP_ROOT, 'verify', 'shot');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const { projectsDir, home, ids } = buildCorpus(root);
  const userData = path.join(root, 'userData');
  const cacheDir = path.join(root, 'cache');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const configFile = path.join(userData, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({
    version: 1,
    setup: { completed: true, completedAt: new Date().toISOString(), appVersion: '0.1.0' },
    platform: { os: 'linux', herdrBin: 'herdr', herdrSocket: path.join(root, 'herdr.sock'), shell: '/bin/bash' },
    profiles: [
      { id: 'personal', label: 'Personal', letter: 'P', color: '#6fa8d8', provider: 'claude', configHome: path.join(home, '.claude'), email: 'you@example.com', isDefault: true },
      { id: 'team', label: 'Team', letter: 'T', color: '#d68a5a', provider: 'claude', configHome: path.join(home, '.claude-team'), email: 'you@example.com', isDefault: false },
    ],
    providers: { claude: { enabled: true, bin: 'claude' }, codex: { enabled: false, bin: 'codex' }, cursor: { enabled: false, bin: 'cursor-agent' } },
    paths: { projectsDir, cacheDir, delegateStateDir: path.join(root, 'delegate'), binDir: path.join(root, 'bin'), projectIconsDir: path.join(root, 'icons'), tasksFile: path.join(root, 'tasks.json') },
    workflows: [],
    orchestration: { enabled: false, launcher: '', researchCommand: '/orchestrate-research', executionCommand: '/orchestrate-execution', stateDir: null },
    newSessionDefaults: { provider: 'claude', model: 'opus', effort: 'xhigh' },
  }, null, 2));

  // Seed the Tasks view through the REAL CLI (bin/harbor-tasks), pointed at this
  // run's own tasks file. Same writer, same reducer, same document the app
  // reads, so the Tasks screenshot is the real surface rather than a mock.
  const tasksFile = path.join(root, 'tasks.json');
  const taskEnv = { ...process.env, HARBOR_TASKS_FILE: tasksFile };
  const task = (...args) => spawnSync(
    path.join(REPO_ROOT, 'bin', 'harbor-tasks'), args, { env: taskEnv, encoding: 'utf8' },
  );
  task('list-add', 'Harbor');
  task('add', 'Ship the release workflow', '--list', 'Harbor', '--due', 'today', '--star');
  task('add', 'Write the setup guide for Windows', '--list', 'Harbor', '--due', '+2d');
  task('add', 'Check the installer warning copy', '--parent', 'Write the setup guide for Windows');
  task('add', 'Reply to the packaging question', '--list', 'Harbor');
  task('add', 'Read the tailnet ACL docs', '--list', 'Harbor', '--due', '+5d');
  task('add', 'Rotate the demo token', '--list', 'Harbor');
  task('done', 'Rotate the demo token');

  // Its own daemon, in its own directory, so the shot shows a connected app and
  // still cannot touch the real session store.
  const daemon = require('node:child_process').spawn(
    process.execPath,
    [path.join(APP_ROOT, 'src', 'daemon', 'daemon.js')],
    {
      stdio: 'ignore',
      detached: true,
      env: {
        ...process.env,
        HARBOR_SESSIOND_DIR: path.join(root, 'sessiond'),
        HARBOR_SESSIOND_SOCKET: path.join(root, 'sessiond', 'sessiond.sock'),
      },
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [APP_ROOT, `--user-data-dir=${userData}`],
    cwd: APP_ROOT,
    timeout: 120000,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      HARBOR_E2E: '1',
      HARBOR_E2E_FAKE_LAUNCH: '1',
      HARBOR_E2E_USER_DATA: userData,
      HARBOR_CONFIG_FILE: configFile,
      HARBOR_CONTEXT_DIR: path.join(root, 'context'),
      HARBOR_ARTIFACTS_ROOTS: path.join(root, 'artifacts'),
      HARBOR_ARTIFACTS_CACHE: path.join(cacheDir, 'artifacts-index.json'),
      HARBOR_ARTIFACT_THUMBS_DIR: path.join(cacheDir, 'thumbs'),
      HARBOR_TASKS_FILE: path.join(root, 'tasks.json'),
      HARBOR_SESSIOND_DIR: path.join(root, 'sessiond'),
      HARBOR_SESSIOND_SOCKET: path.join(root, 'sessiond', 'sessiond.sock'),
      HARBOR_DELEGATE_STATE_DIR: path.join(root, 'delegate'),
      HARBOR_NO_USAGE_FETCH: '1',
      HARBOR_NO_MODEL_DISCOVERY: '1',
      HARBOR_NO_TITLER: '1',
      HARBOR_NO_VOICE: '1',
      ELECTRON_DISABLE_GPU: '1',
    },
  });

  try {
    const page = await app.firstWindow({ timeout: 120000 });
    await page.waitForSelector('.rail', { timeout: 60000 });
    await page.setViewportSize({ width: 1600, height: 1000 });
    // The index scans the fixture corpus cold, so wait for rail ROWS rather
    // than for a fixed delay: a screenshot taken before they land shows an
    // empty rail, which is the app's signature surface missing from its own
    // picture.
    await page.locator('[data-filter="all"]').click().catch(() => {});
    await page.waitForSelector('.sr', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // Expand the project groups so the rail shows sessions, not just headings.
    for (const handle of await page.locator('.sidebar-project-wrap .pg-label').all()) {
      await handle.click().catch(() => {});
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(800);

    for (const { id } of ids.slice(0, 2)) {
      await page.evaluate((sessionId) => window.__harborOpenSession(sessionId), id);
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(2500);

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const shot = async (name, target) => {
      const file = path.join(SHOT_DIR, `${name}.png`);
      await (target || page).screenshot({ path: file });
      process.stdout.write(`wrote ${file}\n`);
    };

    // 1. The hero: the rail plus two conversation windows on the stage. Also
    //    written to docs/screenshot.png, which is what the README embeds.
    await page.screenshot({ path: OUT });
    process.stdout.write(`wrote ${OUT}\n`);
    await shot('stage');

    // 2. The adaptive grid. Opening the rest of the corpus moves the stage from
    //    a 2-up split to an equal-cell grid, which is the claim in the README
    //    about up to sixteen windows; two windows do not show it.
    for (const { id } of ids.slice(2)) {
      await page.evaluate((sessionId) => window.__harborOpenSession(sessionId), id);
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(2000);
    await shot('grid');

    // 3. The capability menu behind the command bar's model chip: live models,
    //    effort, permission mode. This is the per-session control surface and it
    //    is invisible in any static shot of the stage.
    await page.locator('.model-chip.mswitch').first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot('session-config');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);

    // 4. The Tasks view, seeded through the real CLI before launch so what is
    //    on screen came through the same writer an agent would use.
    await page.locator('.view-switch-btn', { hasText: 'Tasks' }).first()
      .click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // Land on the seeded LIST, not on My Day. My Day is empty by design until
    // you put something in it, and an empty pane is a poor picture of a feature.
    await page.locator('.tasks-nav-btn', { hasText: 'Harbor' }).first()
      .click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await shot('tasks');

    // 5. Files (Artifacts): discovered from transcripts, rendered inline.
    await page.locator('.view-switch-btn', { hasText: 'Files' }).first()
      .click({ timeout: 5000 }).catch(() => {});
    // The artifact index is built in the background from the transcripts, so a
    // fixed short delay photographs the empty state rather than the feature.
    await page.waitForSelector('.artifact-card, .art-card, .artifacts-grid > *', { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    const artifactCount = await page.evaluate(() => document
      .querySelectorAll('.artifact-card, .art-card, .artifacts-grid > *').length);
    if (artifactCount > 0) await shot('files');
    else process.stdout.write('SKIPPED files: artifact index still empty\n');
  } finally {
    await app.close({ force: true }).catch(() => {});
    try { process.kill(-daemon.pid, 'SIGTERM'); } catch { try { daemon.kill('SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`capture-screenshot failed: ${error.message}\n`);
  process.exit(1);
});
