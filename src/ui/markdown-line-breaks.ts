// Only bare line-break tags become Markdown breaks. Other HTML stays escaped;
// code nodes and source positions remain untouched.
type Node = {
  type: string;
  value?: string;
  position?: unknown;
  children?: Node[];
};
export function remarkLineBreaks() {
  return (tree: Node) => {
    const visit = (node: Node) => {
      node.children?.forEach((child, index) => {
        if (child.type === 'html' && /^<br\s*\/?>$/i.test(child.value ?? '')) {
          node.children![index] = { type: 'break', position: child.position };
        } else visit(child);
      });
    };
    visit(tree);
  };
}
