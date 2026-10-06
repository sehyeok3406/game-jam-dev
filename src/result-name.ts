import { CanvasError } from './app-errors.ts';

export const MAX_RESULT_NAME = 80;
export function resultName(value?: unknown): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string')
    throw new CanvasError('GC-AI-001', '결과 이름은 텍스트로 입력해주세요.');
  const name = value.normalize('NFC').trim();
  if (!name) return '';
  if (
    name.length > MAX_RESULT_NAME ||
    !/^[\p{L}\p{M}\p{N} _-]+$/u.test(name) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)
  )
    throw new CanvasError(
      'GC-AI-001',
      '이름은 80자 이하의 한글·문자·숫자·공백·하이픈·밑줄로 입력해주세요. 경로나 확장자는 입력하지 마세요.',
    );
  return name;
}
export const resultFileStem = (value?: unknown) =>
  resultName(value).replace(/ +/g, '-');
