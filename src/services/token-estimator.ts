let tiktokenAvailable: boolean | null = null;

export async function estimateTokens(text: string): Promise<number> {
  if (!text) return 0;

  if (tiktokenAvailable !== false) {
    try {
      const { encoding_for_model } = await import("tiktoken");
      const enc = encoding_for_model("gpt-4o");
      const count = enc.encode(text).length;
      enc.free();
      tiktokenAvailable = true;
      return count;
    } catch {
      tiktokenAvailable = false;
    }
  }

  return Math.ceil(text.length / 4);
}
