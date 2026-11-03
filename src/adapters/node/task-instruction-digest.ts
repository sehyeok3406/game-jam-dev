import { createHash } from 'node:crypto';
export const taskInstructionDigest = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');
