import test from 'node:test';
import assert from 'node:assert/strict';
import { projectForWeb, webProjectId } from '../src/web-viewer.ts';
test('web export preserves real content, sections and layouts without transport credentials or AI instructions', () => {
  const project = projectForWeb({
    libraryId: 'local:C:\\private\\project',
    name: 'Project',
    source: 'published',
    files: {
      'project.md':
        '---\nid: overview\ntitle: Actual name\ntype: overview\n---\n# Actual name\n',
      'ideas/a.md':
        '---\nid: a\ntitle: Real idea\nx: 234\ny: 567\nbackground_color: purple\n---\nOriginal body\n',
      'sections/s.md':
        '---\nid: s\ntitle: Section\nx: 100\ny: 100\nwidth: 800\nheight: 600\nmembers:\n  - id: a\n    path: ideas/a.md\n---\n',
      '.ai/tasks/private.md':
        '---\nid: task\ntitle: Private task\ntype: ai-task\n---\nPRIVATE_INSTRUCTIONS',
    },
  });
  assert.equal(project.name, 'Actual name');
  assert.equal(project.id, webProjectId('local:C:\\private\\project'));
  assert.deepEqual(project.documents.find((doc) => doc.id === 'a').position, {
    x: 234,
    y: 567,
  });
  assert.equal(
    project.documents.find((doc) => doc.id === 'a').section,
    'Section',
  );
  assert.equal(
    project.documents.find((doc) => doc.id === 'a').body,
    'Original body',
  );
  assert.equal(project.documents.find((doc) => doc.id === 'a').color, 'purple');
  assert.equal(project.sections[0].width, 800);
  assert.equal(project.readOnly, true);
  assert.ok(!JSON.stringify(project).includes('PRIVATE_INSTRUCTIONS'));
  assert.ok(!JSON.stringify(project).includes('C:\\private'));
});
test('HTML and image cards retain inline display data', () => {
  const project = projectForWeb({
    libraryId: 'shared:test',
    name: 'Shared',
    source: 'shared',
    files: {
      'docs/html.md':
        '---\nid: html\ntitle: Html\nhtml_source: output/index.html\n---\nDescription',
      'output/index.html': '<!doctype html><p>Real output</p>',
    },
  });
  assert.equal(project.documents[0].kind, 'html');
  assert.match(project.documents[0].html, /Real output/);
});

test('AI-generated versioned Markdown stays readable and on its original canvas', () => {
  const project = projectForWeb({
    libraryId: 'shared:ufo',
    name: 'UFO',
    source: 'shared',
    revision: 214,
    files: {
      'docs/versions/v8/UFO-core-loop.md':
        '---\nid: ufo-loop\ntitle: UFO 핵심 플레이 흐름\ntype: system\nx: 3100\ny: -2900\n---\n## 플레이 흐름\nAI generated content',
      '.ai/tasks/private.md':
        '---\nid: private\ntype: ai-task\n---\nPRIVATE_AI_INSTRUCTIONS',
    },
  });
  assert.equal(project.documents.length, 1);
  assert.equal(project.documents[0].kind, 'document');
  assert.equal(project.documents[0].title, 'UFO 핵심 플레이 흐름');
  assert.match(project.documents[0].body, /AI generated content/);
  assert.deepEqual(project.documents[0].position, { x: 3100, y: -2900 });
  assert.notEqual(project.documents[0].onCanvas, false);
});
