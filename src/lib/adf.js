export function adfDoc(text) {
  const paragraphs = String(text || '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const blocks = paragraphs.length ? paragraphs : [''];
  return {
    type: 'doc',
    version: 1,
    content: blocks.map((paragraph) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: paragraph.slice(0, 2000) }],
    })),
  };
}
