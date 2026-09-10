import { build,context } from "esbuild";
import { cp,mkdir,readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root=resolve("extension"),dist=resolve(root,"dist"),watch=process.argv.includes("--watch");
try{await import("./clean.mjs");}catch(error){if(error?.code!=="EPERM")throw error;console.warn("Extension dist is in use by Chrome; rebuilding files in place.");}await mkdir(resolve(dist,"background"),{recursive:true});await mkdir(resolve(dist,"content"),{recursive:true});await mkdir(resolve(dist,"sidepanel"),{recursive:true});await mkdir(resolve(dist,"assets"),{recursive:true});
const shared={bundle:true,outdir:dist,format:"esm",platform:"browser",target:"chrome114",jsx:"automatic",sourcemap:false,minify:true,legalComments:"none"};
const builds=[
  {...shared,entryPoints:{"background/service-worker":resolve(root,"background/service-worker.js"),"content/dashboard-bridge":resolve(root,"content/dashboard-bridge.js"),"content/resume-upload":resolve(root,"content/resume-upload.js"),"content/personal-autofill":resolve(root,"content/personal-autofill.js")}},
  {...shared,entryPoints:{"sidepanel/index":resolve(root,"sidepanel/main.jsx")},splitting:true,chunkNames:"chunks/[name]-[hash]"},
];
if(watch){const contexts=await Promise.all(builds.map(options=>context(options)));await Promise.all(contexts.map(ctx=>ctx.watch()));console.log("Watching extension sources…");}else await Promise.all(builds.map(options=>build(options)));
for(const [source,target] of [["manifest.json","manifest.json"],["sidepanel/index.html","sidepanel/index.html"]])await cp(resolve(root,source),resolve(dist,target));
for(const size of [16,48,128])await cp(resolve(root,`assets/icon${size}.png`),resolve(dist,`assets/icon${size}.png`));
await cp(resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"),resolve(dist,"assets/pdf.worker.min.mjs"));
const manifest=JSON.parse(await readFile(resolve(dist,"manifest.json"),"utf8"));if(manifest.version!=="1.7.0")throw new Error("Built manifest must be version 1.7.0");
const html=await readFile(resolve(dist,"sidepanel/index.html"),"utf8");if(/<script[^>]+src=["']https?:/i.test(html))throw new Error("Remote executable code detected");
console.log("Built extension/dist");
