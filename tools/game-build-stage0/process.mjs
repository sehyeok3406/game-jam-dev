import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(read, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await pause(100);
  }
  throw Error(`Timeout: ${label}`);
}

// Only children owned by this spike are terminated. No existing browser is used.
export async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn(
        'taskkill.exe',
        ['/pid', String(child.pid), '/T', '/F'],
        {
          windowsHide: true,
          shell: false,
          stdio: 'ignore',
        },
      );
      killer.once('error', resolve);
      killer.once('close', resolve);
    });
  } else child.kill('SIGTERM');
}

export async function runProcess(executable, args, options = {}) {
  const { timeout = 120000, ...spawnOptions } = options;
  const child = spawn(executable, args, {
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...spawnOptions,
  });
  let stdout = '',
    stderr = '';
  child.stdout?.on('data', (data) => (stdout = (stdout + data).slice(-200000)));
  child.stderr?.on('data', (data) => (stderr = (stderr + data).slice(-200000)));
  const timer = setTimeout(() => void terminate(child), timeout);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (code !== 0)
      throw Error(
        `Process failed (${code}): ${path.basename(executable)}\n${stderr || stdout}`,
      );
    return { stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

export async function fingerprintTree(directory) {
  const result = [];
  const walk = async (relative) => {
    for (const entry of (
      await fs.readdir(path.join(directory, relative), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink())
        throw Error(`Unexpected dependency symlink: ${name}`);
      if (entry.isDirectory()) await walk(name);
      else {
        const bytes = await fs.readFile(path.join(directory, name));
        result.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  };
  await walk('');
  return result;
}

export async function cdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    for (const callback of listeners.get(message.method) ?? [])
      callback(message.params);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.error) call.reject(Error(JSON.stringify(message.error)));
    else call.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`CDP timeout: ${method}`));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return {
    send,
    on(method, callback) {
      listeners.set(method, [...(listeners.get(method) ?? []), callback]);
    },
    async js(expression) {
      const value = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (value.exceptionDetails)
        throw Error(
          value.exceptionDetails.exception?.description ??
            value.exceptionDetails.text,
        );
      return value.result.value;
    },
    close() {
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(Error('CDP closed'));
      }
      pending.clear();
      socket.close();
    },
  };
}
