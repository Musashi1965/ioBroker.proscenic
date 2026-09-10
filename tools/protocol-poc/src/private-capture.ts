import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface PrivateCaptureWriter {
  readonly filePath: string;
  write(record: unknown): Promise<void>;
  close(): Promise<void>;
}

export async function createPrivateCaptureWriter(enabled: boolean): Promise<PrivateCaptureWriter | undefined> {
  if (!enabled) {
    return undefined;
  }

  const directory = join(process.cwd(), ".poc-private", "protocol-poc");
  const filePath = join(directory, `${new Date().toISOString().replace(/[:.]/gu, "-")}.jsonl`);
  await mkdir(dirname(filePath), {
    recursive: true,
    mode: 0o700,
  });
  const file = await open(filePath, "wx", 0o600);

  return {
    filePath,
    async write(record: unknown): Promise<void> {
      await file.write(`${JSON.stringify(record)}\n`);
    },
    async close(): Promise<void> {
      await file.close();
    },
  };
}
