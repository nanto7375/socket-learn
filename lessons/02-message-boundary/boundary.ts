export function splitBytes(
  bytes: Buffer,
  splitPoints: readonly number[],
): Buffer[] {
  const points = [0, ...splitPoints, bytes.length];
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    if (end === undefined || start < 0 || end <= start || end > bytes.length) {
      throw new RangeError("splitPoints must be strictly increasing");
    }
    return bytes.subarray(start, end);
  });
}

export function interpretEachChunkAsMessage(
  chunks: readonly Buffer[],
): string[] {
  return chunks.map((chunk) => chunk.toString("utf8"));
}
