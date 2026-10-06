import matter from 'gray-matter';

/** Network/AI documents are data, never executable frontmatter engines. */
const parseMarkdown = Object.assign(
  (raw: string) => {
    const input = raw.replace(/^\uFEFF/, '');
    const first = input.split(/\r?\n/, 1)[0];
    if (
      first.startsWith('---') &&
      !['', 'yaml', 'yml'].includes(first.slice(3).trim())
    )
      throw new Error('문서는 YAML frontmatter만 사용할 수 있습니다.');
    return matter(input, { language: 'yaml' });
  },
  { stringify: matter.stringify },
);

export default parseMarkdown;
