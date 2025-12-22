import { File } from "node:buffer";

if (!globalThis.File) {
  (globalThis as any).File = File;
}
