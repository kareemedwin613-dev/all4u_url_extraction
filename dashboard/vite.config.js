import {defineConfig} from "vite";import react from "@vitejs/plugin-react";import {resolve} from "node:path";
const vendorChunk=id=>{if(!id.includes("node_modules"))return;if(id.includes("antd")||id.includes("@ant-design")||id.includes("rc-"))return "ant-design";if(id.includes("@supabase"))return "supabase";if(id.includes("react"))return "react";};
export default defineConfig({root:resolve(import.meta.dirname),plugins:[react()],build:{outDir:"dist",emptyOutDir:true,chunkSizeWarningLimit:900,rollupOptions:{output:{manualChunks:vendorChunk}}},server:{port:4174},preview:{port:4175}});
