export function createEventLogger(
  label: string,
  sink: (line: string) => void = console.log,
): (event: string, detail?: string) => void {
  let sequence = 0;
  return (event, detail) => {
    sequence += 1;
    sink(`[${label} #${sequence}] ${event}${detail ? ` ${detail}` : ""}`);
  };
}
