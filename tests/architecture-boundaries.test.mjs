import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectSource,
  scanArchitecture,
  findingKey,
  compareBaseline,
  verifyArchitecture,
} from '../scripts/architecture-boundaries.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const resolve = (specifier, from) =>
  specifier.startsWith('.')
    ? path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
    : undefined;
const inspect = (file, source) => inspectSource(file, source, resolve);

test('repository boundaries match the reviewed exceptions', () => {
  assert.deepEqual(verifyArchitecture(root), []);
});

test('allowed layers, adapters and composition roots remain usable', () => {
  for (const [file, source] of [
    ['src/contracts/new.ts', "export type { X } from './project.ts';"],
    [
      'src/core/editing/new.ts',
      "import type { X } from '../../contracts/project.ts';",
    ],
    [
      'src/application/editing/new.ts',
      "import { x } from '../../core/editing/layout.ts';",
    ],
    ['src/adapters/filesystem/new.ts', "import fs from 'node:fs';"],
    ['src/main.ts', "import { x } from './adapters/filesystem/new.ts';"],
    [
      'src/server/bootstrap.ts',
      "import { x } from '../adapters/sqlite/project-repository.ts';",
    ],
    [
      'src/ui/New.tsx',
      "import { useRuntime } from './runtime/RuntimeProvider.tsx';",
    ],
    ['src/features/self-host/service.ts', "import fs from 'node:fs';"],
    [
      'src/features/self-host/Dialog.tsx',
      "import { HOST_HELP } from './help.ts';",
    ],
  ])
    assert.deepEqual(inspect(file, source), [], file);
});

test('contracts/core cannot reach implementation or external packages even through type imports', () => {
  for (const file of ['src/contracts/new.ts', 'src/core/new.ts']) {
    for (const source of [
      "import type { X } from '../desktop/secret.ts';",
      "export type { X } from '../server/secret.ts';",
      "type X = import('electron').BrowserWindow;",
      "import { x } from 'react';",
      "import { x } from '../contracts-other/secret.ts';",
    ])
      assert.ok(inspect(file, source).length, `${file}: ${source}`);
  }
});

test('application must use ports and cannot introduce new legacy dependencies', () => {
  for (const target of [
    '../adapters/filesystem/new.ts',
    '../desktop/new.ts',
    '../server/new.ts',
    '../ui/New.tsx',
    '../old-model.ts',
    'node:crypto',
    'react',
  ]) {
    assert.equal(
      inspect('src/application/new.ts', `import { x } from '${target}';`)[0]
        .rule,
      'application-dependency',
    );
  }
});

test('UI blocks implementation, platform modules and self-host backend but checks shared UI helpers too', () => {
  for (const target of [
    'node:fs',
    'fs/promises',
    'electron',
    '../main.ts',
    '../application/new.ts',
    '../desktop/new.ts',
    '../adapters/new.ts',
    '../server/new.ts',
    '../features/self-host/service.ts',
  ]) {
    assert.equal(
      inspect('src/ui/New.tsx', `import { x } from '${target}';`)[0].rule,
      'ui-platform-dependency',
    );
  }
  assert.equal(
    inspect('src/features/self-host/help.ts', "import fs from 'node:fs';")[0]
      .rule,
    'ui-platform-dependency',
  );
});

test('dynamic imports, require and import-equals cannot bypass checks', () => {
  for (const source of [
    "const x = import('node:fs');",
    "const x = require('node:fs');",
    "import x = require('node:fs');",
    'const x = import(`node:fs`);',
  ])
    assert.equal(
      inspect('src/core/nested/new.ts', source)[0].rule,
      'core-dependency',
    );
  for (const source of [
    'import(target)',
    'require(target)',
    'import(`./${name}.ts`)',
  ])
    assert.equal(inspect('src/ui/New.tsx', source)[0].rule, 'dynamic-module');
});

test('bridge and preference access covers brackets, optional access and destructuring, not comments', () => {
  for (const source of [
    'window.gameCanvas.open()',
    "window['gameCanvas'].open()",
    'globalThis?.gameCanvas?.open()',
    "globalThis['localStorage'].getItem('x')",
    'const { gameCanvas: bridge } = window;',
    "const { 'gameCanvas': bridge } = globalThis;",
    "localStorage.getItem('x')",
    'const { localStorage: storage } = window;',
  ])
    assert.ok(
      inspect('src/ui/New.tsx', source).some(
        (item) => item.rule === 'ui-global-access',
      ),
      source,
    );
  assert.deepEqual(
    inspect(
      'src/ui/New.tsx',
      '// window.gameCanvas and localStorage\nconst message = "window.gameCanvas";',
    ),
    [],
  );
  // Previously any file with this basename skipped the regex check.
  assert.equal(
    inspect('src/ui/another/uiDebugPreview.tsx', 'window.gameCanvas')[0].rule,
    'ui-global-access',
  );
});

test('compatibility imports are checked in every source layer', () => {
  for (const source of [
    "import type { X } from '../shared.ts';",
    "export * from '../shared.ts';",
  ])
    assert.equal(
      inspect('src/desktop/new.ts', source)[0].rule,
      'compatibility-import',
    );
  assert.deepEqual(
    inspect(
      'src/desktop/new.ts',
      "import { createCollaborationServer } from '../collaboration-server.ts';",
    ),
    [],
  );
});

test('recursive scan resolves tsconfig aliases, extensionless imports and nested contract files', (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gamejam-architecture-'),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (file, body) => {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  };
  write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        moduleResolution: 'bundler',
        paths: { '@desktop/*': ['./src/desktop/*'] },
      },
    }),
  );
  write('src/desktop/secret.ts', 'export const secret = 1;');
  write('src/shared.ts', 'export type X = string;');
  write(
    'src/contracts/nested/invalid.ts',
    "import { secret } from '@desktop/secret';",
  );
  write('src/ui/New.tsx', "import type { X } from '../shared';");
  const found = scanArchitecture(directory);
  assert.deepEqual(
    found.map(({ rule, target }) => ({ rule, target })),
    [
      { rule: 'contracts-dependency', target: 'src/desktop/secret.ts' },
      { rule: 'compatibility-import', target: 'src/shared.ts' },
    ],
  );
});

test('exceptions cannot grow, move, duplicate or remain after cleanup', () => {
  const item = {
    rule: 'application-dependency',
    file: 'src/application/a.ts',
    target: 'src/old.ts',
    line: 1,
  };
  const group = {
    reason: 'Existing model',
    removeWhen: 'Model moved to core',
    entries: { [findingKey(item)]: 1 },
  };
  const baseline = { groups: [group] };
  assert.deepEqual(compareBaseline([item], baseline), []);
  assert.equal(compareBaseline([item, item], baseline).length, 1);
  assert.equal(compareBaseline([], baseline).length, 1);
  assert.equal(
    compareBaseline([{ ...item, file: 'src/application/b.ts' }], baseline)
      .length,
    2,
  );
  assert.equal(
    compareBaseline([{ ...item, target: 'src/other.ts' }], baseline).length,
    2,
  );
  assert.ok(compareBaseline([item], { groups: [group, group] }).length);
  assert.ok(
    compareBaseline([item], { groups: [{ ...group, reason: '' }] }).length,
  );
  assert.ok(
    compareBaseline([item], { groups: [{ ...group, removeWhen: '' }] }).length,
  );
  assert.ok(
    compareBaseline([item], {
      groups: [{ ...group, entries: { [findingKey(item)]: 0 } }],
    }).length,
  );
});
