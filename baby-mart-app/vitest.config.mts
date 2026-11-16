import { defineConfig } from "vitest/config";
import path from "path";

// The @/ alias from tsconfig, so tests can import modules that use it.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
