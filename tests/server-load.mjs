import assert from 'node:assert/strict';
import { CollaborationClient } from '../src/collaboration-client.ts';

/** A local fixture, not a capacity guarantee or public-network benchmark. */
export async function measureServerLoad(url, key) {
  const groups = [],
    clients = [],
    samples = [];
  let attempted = 0,
    succeeded = 0;
  const timed = async (work) => {
    attempted++;
    const start = performance.now();
    try {
      const result = await work();
      succeeded++;
      return result;
    } finally {
      samples.push(performance.now() - start);
    }
  };
  try {
    for (let project = 0; project < 5; project++) {
      const files = {
        'project.md': `---\nid: project\ntitle: 부하 ${project}\n---\n한글 프로젝트`,
      };
      for (let n = 0; n < 50; n++)
        files[`ideas/doc-${n}.md`] =
          `---\nid: doc-${n}\ntitle: 문서 ${n}\ntype: idea\nx: 0\ny: 0\nwidth: 340\nheight: 300\n---\n원본 본문 ${n}`;
      files['assets/images/test.png'] =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
      const created = await CollaborationClient.create(
        url,
        key,
        '관리자',
        `부하 ${project}`,
        files,
      );
      const group = [];
      for (let actor = 0; actor < 4; actor++) {
        const joined = actor
          ? await CollaborationClient.join(
              url,
              created.result.code,
              `편집자${actor}`,
            )
          : created;
        const client = new CollaborationClient(joined.credentials, () => {});
        client.accept(joined.result);
        group.push(client);
        clients.push(client);
      }
      groups.push(group);
    }
    for (const group of groups)
      for (let n = 0; n < group.length; n++) {
        await group[n].refresh();
        await group[n].lock(`ideas/doc-${n}.md`);
        await timed(() =>
          group[n].command('documents:save', {
            relativePath: `ideas/doc-${n}.md`,
            documentId: `doc-${n}`,
            title: `저장 ${n}`,
            body: `한글 편집 ${n}`,
          }),
        );
        await group[n].unlock(`ideas/doc-${n}.md`);
      }
    await Promise.all(
      groups.flatMap((group) =>
        group.map(async (client, n) => {
          await client.refresh();
          await timed(() =>
            client.command('documents:update-layout', {
              relativePath: `ideas/doc-${n}.md`,
              x: 100 + n,
              y: 200 + n,
              width: 350,
              height: 310,
            }),
          );
        }),
      ),
    );
    const reconnects = [];
    for (const client of clients) {
      const reconnect = new CollaborationClient(client.credentials, () => {});
      reconnects.push(reconnect);
      try {
        await reconnect.refresh();
        assert.equal(reconnect.state.connected, true);
      } finally {
        reconnect.stop();
      }
    }
    assert.equal(succeeded, 40);
    samples.sort((a, b) => a - b);
    return {
      projects: 5,
      clients: 20,
      documentsPerProject: 50,
      imagesPerProject: 1,
      commands: attempted,
      succeeded,
      failureRate: (attempted - succeeded) / attempted,
      commandP95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
      reconnects: reconnects.length,
      network: 'loopback',
      sustainedCapacityVerified: false,
    };
  } finally {
    clients.forEach((client) => client.stop());
  }
}
