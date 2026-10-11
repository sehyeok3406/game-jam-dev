import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlReferences } from '../src/html-references.ts';
import {
  inspectImportedHtml,
  describePreview,
  htmlSourcePath,
  sourceMetadata,
} from '../src/html-source.ts';
import { describeHtmlInput } from '../src/html-inputs.ts';
import { createTaskFiles } from '../src/task-plan.ts';
import { encodeAsset, buildFileImports } from '../src/file-assets.ts';

const bundle = `function isUrl(r){return /url\\(/i.test(r)}
function toDataURL(a){return a.toDataURL()}
const r='data:image/png;base64,AAAA',a={toDataURL(){return r}},t=a;
isUrl(r);toDataURL(a);t.toDataURL('image/png');
const examples='url(fake.png) fetch("fake.json") import("fake.js")';
const pattern=/url\\(t\\)/;
// fetch('comment.json'); url(comment.png)
/* import 'comment.js'; @import 'comment.css'; */
globalThis.__htmlReferenceExecuted = true;`;
const standalone = `<html><head><style>
/* url(comment.png) @import 'comment.css'; */
body{background-image:url(data:image/png;base64,AAAA)}
p::after{content:'url(fake.png)'}
</style></head><body><p>Game</p>
<img src="data:image/png;base64,AAAA" srcset="data:image/png;base64,AAAA 1x, data:image/png;base64,BBBB 2x">
<a href="https://example.test/help">Help</a>
<script>${bundle}</script>
<script type="application/json">{"example":"url(fake.png)"}</script></body></html>`;

test('bundled isUrl/toDataURL, comments, strings and inline data are not dependencies and are never executed', () => {
  assert.deepEqual(htmlReferences(standalone, 'html'), []);
  assert.deepEqual(inspectImportedHtml(standalone, 'pixi.html'), []);
  assert.deepEqual(htmlReferences(bundle, 'js'), []);
  assert.equal(globalThis.__htmlReferenceExecuted, undefined);
  const files = buildFileImports({
    x: 10,
    y: 20,
    imagePurpose: 'asset',
    files: [{ name: 'pixi.html', content: standalone }],
  });
  const path = Object.keys(files).find((path) => path.endsWith('.html'));
  assert.deepEqual(describePreview(files, path).warnings, []);
  assert.deepEqual(describeHtmlInput(files, path).warnings, []);
  for (const kind of ['organize', 'implement'])
    assert.doesNotThrow(() =>
      createTaskFiles(
        {
          kind,
          sourceMode: kind === 'organize' ? 'html' : 'html-compose',
          inputPaths: [path],
          documentResult: { mode: 'new' },
          htmlResult: { mode: 'new' },
          x: 800,
          y: 20,
        },
        'reference-test',
        files,
      ),
    );
});

test('real HTML attributes and CSS references remain visible; srcset data URLs do not split into fake files', () => {
  const html = `<html><head><link rel="stylesheet" href="./style.css"><style>
@import './theme.css'; .a{background:URL(./bg.png)}
.b{background:url("./with space.png")} .c{background:url(data:image/png;base64,AAAA)}
</style></head><body style="background:url('./inline.png')"><p>Game</p>
<img src="./image.png" srcset="data:image/png;base64,AAAA 1x, ./image2.png 2x, ./image3.png 3x">
<video poster="./poster.png"></video><script src="./game.js"></script>
<svg><use href="#shape"></use></svg><img src="blob:https://example.test/id">
</body></html>`;
  assert.deepEqual(
    new Set(htmlReferences(html, 'html')),
    new Set([
      './style.css',
      './theme.css',
      './bg.png',
      './with space.png',
      './inline.png',
      './image.png',
      './image2.png',
      './image3.png',
      './poster.png',
      './game.js',
    ]),
  );
  assert.match(inspectImportedHtml(html, 'dependencies.html')[0], /외부 파일/);
});

test('JavaScript literal network loads and module imports are detected, variable arguments and similarly named helpers are not', () => {
  const js = `import './static.js'; export { x } from './export.js';
fetch('./data.json'); window.fetch('https://example.test/data');
import('./dynamic.js'); import(\`./template.js\`);
new Worker('./worker.js'); new Audio('./sound.ogg');
new URL('./module.png', import.meta.url);
new URL('https://example.test/formatting-only');
const img=new Image();img.src='./image.png';img.setAttribute('src','./other.png');
const xhr=new XMLHttpRequest();xhr.open('GET','./api.json');
fetch(variable); import(variable); new Worker(variable);
isUrl(r); toDataURL(a); obj.toDataURL(t);
fetch('data:text/plain,ok'); fetch('blob:https://example.test/id');`;
  assert.deepEqual(
    new Set(htmlReferences(js, 'js')),
    new Set([
      './static.js',
      './export.js',
      './data.json',
      'https://example.test/data',
      './dynamic.js',
      './template.js',
      './worker.js',
      './sound.ogg',
      './module.png',
      './image.png',
      './other.png',
      './api.json',
    ]),
  );
});

test('cached inspection stays independent of source edits, parsing context and caller mutation', () => {
  const source = 'fetch("./data.json")';
  const first = htmlReferences(source, 'js');
  first.push('fake');
  assert.deepEqual(htmlReferences(source, 'js'), ['./data.json']);
  assert.deepEqual(htmlReferences(source, 'html'), []);
  assert.deepEqual(
    htmlReferences(source.replace('data.json', 'next.json'), 'js'),
    ['./next.json'],
  );
});

test('related CSS and JS files use the same syntax inspection and still reject missing dependencies', () => {
  const path = 'output/prototypes/bundle/v001/index.html';
  const js = path.replace('index.html', 'game.js');
  const css = path.replace('index.html', 'style.css');
  const html =
    '<html><head><link rel="stylesheet" href="./style.css"></head><body><p>Game</p><script src="./game.js"></script></body></html>';
  const files = {
    [path]: html,
    [htmlSourcePath(path)]: sourceMetadata(path, html),
    [js]: encodeAsset(js, Buffer.from(bundle)),
    [css]: encodeAsset(
      css,
      Buffer.from(
        '/* url(fake.png) */ body{background:url(data:image/png;base64,AAAA)}',
      ),
    ),
  };
  assert.deepEqual(describeHtmlInput(files, path).warnings, []);
  for (const [file, content] of [
    [js, "fetch('./missing.json')"],
    [css, "body{background:url('./missing.png')}"],
    [css, "@import './missing.css';"],
  ])
    assert.throws(
      () =>
        describeHtmlInput(
          { ...files, [file]: encodeAsset(file, Buffer.from(content)) },
          path,
        ),
      /관련 파일이 없거나/,
    );
});

test('unsupported script syntax and non-JavaScript script blocks do not turn arbitrary text into file paths', () => {
  assert.deepEqual(
    htmlReferences(
      '<p>url(r) fetch("fake")</p><script type="application/ld+json">{"x":"url(t)"}</script><script>const = url(a)</script>',
      'html',
    ),
    [],
  );
  assert.deepEqual(
    htmlReferences('/* url(fake) */ p{content:"url(fake)"}', 'css'),
    [],
  );
  assert.deepEqual(htmlReferences('body{background:url(\\62 g.png)}', 'css'), [
    'bg.png',
  ]);
});
