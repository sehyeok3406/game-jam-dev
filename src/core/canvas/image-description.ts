/** Split only the scaffold written by the image import workflow. */
export function imageDescription(body: string, assetPath: string) {
  const scaffold =
    /^!\[불러온 이미지\]\(([^\r\n]+)\)\r?\n\r?\n## 이미지 용도\r?\n\r?\n[^\r\n]+\r?\n\r?\n## 설명\r?\n\r?\n/.exec(
      body,
    );
  const footer = `원본 이미지: \`${assetPath}\``;
  const footerIndex = body.lastIndexOf(footer);
  if (
    !scaffold ||
    scaffold[1] !== `../${assetPath}` ||
    footerIndex < scaffold[0].length ||
    body[footerIndex - 1] !== '\n' ||
    body.slice(footerIndex + footer.length).trim()
  )
    return undefined;
  const prefix = scaffold[0];
  const description = body.slice(prefix.length, footerIndex);
  const trailing = /\s*$/.exec(description)![0];
  return {
    body: description.slice(0, description.length - trailing.length),
    replace: (next: string) =>
      `${prefix}${next}${trailing || '\n\n'}${body.slice(footerIndex)}`,
  };
}
