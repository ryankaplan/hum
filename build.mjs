import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  outfile: "public/dist/bundle.js",
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  sourcemap: true,
  define: {
    "process.env.NODE_ENV": watch ? '"development"' : '"production"',
  },
});

if (watch) {
  await ctx.watch();
  const { host, port } = await ctx.serve({
    servedir: "public",
    fallback: "public/index.html",
  });
  console.log(`Dev server running at http://${host}:${port}`);
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("Build complete.");
}
