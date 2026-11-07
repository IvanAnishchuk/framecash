import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works under GitHub Pages' /framecash/ prefix.
  base: "./",
  // The app imports the shared library from ../lib by relative path.
  server: { fs: { allow: [".."] } },
  build: { target: "es2022" },
});
