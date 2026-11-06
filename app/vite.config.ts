import { defineConfig } from "vite";

export default defineConfig({
  // The app imports the shared library from ../lib by relative path.
  server: { fs: { allow: [".."] } },
  build: { target: "es2022" },
});
