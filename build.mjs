import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const watch = process.argv.includes("--watch");

function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes}b`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}kb`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}

function summarizeBuildOutputs(metafile) {
  const outputs = Object.entries(metafile.outputs)
    .map(([path, output]) => ({
      path,
      bytes: output.bytes,
      gzipBytes: gzipSync(readFileSync(path)).byteLength,
    }))
    .sort((left, right) => {
      const leftIsMap = left.path.endsWith(".map");
      const rightIsMap = right.path.endsWith(".map");

      if (leftIsMap !== rightIsMap) {
        return leftIsMap ? 1 : -1;
      }

      return left.path.localeCompare(right.path);
    });

  const longestPath = Math.max(...outputs.map((output) => output.path.length), 5);
  const lines = outputs.map(
    (output) =>
      `  ${output.path.padEnd(longestPath)}  ${formatSize(output.bytes).padStart(7)}  gzip ${formatSize(output.gzipBytes).padStart(7)}`,
  );

  return `Build output:\n${lines.join("\n")}`;
}

const ctx = await esbuild.context({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  outfile: "public/dist/bundle.js",
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  metafile: !watch,
  minify: !watch,
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
  const result = await ctx.rebuild();
  await ctx.dispose();
  console.log(summarizeBuildOutputs(result.metafile));
}
