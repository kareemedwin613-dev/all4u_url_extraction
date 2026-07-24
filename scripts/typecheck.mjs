import {build} from "esbuild";
const viteUrlStub={name:"vite-url-stub",setup(context){context.onResolve({filter:/\?url$/},args=>({path:args.path,namespace:"vite-url"}));context.onLoad({filter:/.*/,namespace:"vite-url"},()=>({contents:"export default 'local-build-asset';",loader:"js"}));}};
await build({entryPoints:["dashboard/src/main.jsx"],bundle:true,write:false,outdir:".typecheck/dashboard",platform:"browser",format:"esm",jsx:"automatic",logLevel:"warning",plugins:[viteUrlStub]});
await build({entryPoints:["extension/background/service-worker.js","extension/sidepanel/index.js"],bundle:true,write:false,outdir:".typecheck/extension",platform:"browser",format:"esm",target:"chrome114",logLevel:"warning"});
console.log("Validated dashboard and extension JavaScript module contracts (the repository does not use TypeScript)");
