export function parseModelJson(value: string): unknown {
  try { return JSON.parse(value); }
  catch (error) {
    // Some JSON-mode replies escape Markdown punctuation (e.g. \+) inside
    // strings. Normalize only those escapes; never guess object structure,
    // missing quotes, truncation, or invalid Unicode. Valid JSON is untouched.
    const markdown = new Set(["+", "-", "*", "_", "#", "[", "]", "(", ")", ".", "!", "|", ">", "~", "`"]);
    let quoted = false; let normalized = "";
    for (let i = 0; i < value.length; i++) {
      const character = value[i];
      if (quoted && character === "\\") {
        const next = value[i + 1];
        normalized += markdown.has(next) ? next : character + (next ?? "");
        i++; continue;
      }
      normalized += character;
      if (character === '"') quoted = !quoted;
    }
    if (normalized === value) throw error;
    return JSON.parse(normalized);
  }
}
