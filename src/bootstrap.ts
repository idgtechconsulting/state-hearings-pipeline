import { File } from "node:buffer";

// Provide a global File polyfill for libraries that expect it
if (!globalThis.File) {
  (globalThis as any).File = File;
}
