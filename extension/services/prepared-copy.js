// Keep only the last prepared item in panel memory. Never persist candidate text.
export function createPreparedCopy(prepare, writeText = text => navigator.clipboard.writeText(text)) {
  let pending = null;
  return async function copy(id) {
    if (pending?.id !== id) {
      pending = null;
      pending = { id, data: await prepare(id) };
    }
    const data = pending.data;
    try {
      // On retry there is no preceding await: clipboard access starts in the click.
      await writeText(data.text);
    } catch {
      return { copied: false, resumeType: data.resumeType };
    }
    pending = null;
    return { copied: true, resumeType: data.resumeType };
  };
}
