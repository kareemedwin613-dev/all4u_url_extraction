export function safeExternalUrl(value){try{const url=new URL(String(value||""));return ["http:","https:"].includes(url.protocol)?url.href:null;}catch{return null;}}
