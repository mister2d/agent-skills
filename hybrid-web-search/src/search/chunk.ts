export function chunkText(text: string, tokenTarget: number): string[] {
  const charTarget = tokenTarget * 4;
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if ((current + para).length > charTarget && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());

  return chunks.filter((c) => c.length > 80);
}
