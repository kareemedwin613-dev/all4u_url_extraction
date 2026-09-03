const CACHE_PREFIX="lookup-cache-v1:";
const FRESH_MS=30*60_000;
const MAX_STALE_MS=24*60*60_000;
const memory=new Map(),inFlight=new Map();

function cacheKey(client,name){
  let project="default";
  try{project=new URL(String(client?.supabaseUrl||"")).hostname||project;}catch{}
  return `${CACHE_PREFIX}${project}:${name}`;
}

async function refresh(key,loader,storage){
  if(inFlight.has(key))return inFlight.get(key);
  const pending=(async()=>{
    const rows=await loader();
    if(!Array.isArray(rows))throw new Error("Lookup response must be an array.");
    const record={storedAt:Date.now(),rows};
    memory.set(key,record);
    if(storage)await storage.set({[key]:record}).catch(()=>{});
    return rows;
  })().finally(()=>inFlight.delete(key));
  inFlight.set(key,pending);
  return pending;
}

export async function loadCachedLookup(client,name,loader){
  const key=cacheKey(client,name),now=Date.now(),storage=globalThis.chrome?.storage?.local;
  const current=memory.get(key);
  if(current&&now-current.storedAt<=FRESH_MS)return current.rows;
  let stored=current;
  if(!stored&&storage){
    try{stored=(await storage.get(key))[key];}catch{}
  }
  if(stored&&Array.isArray(stored.rows)&&Number.isFinite(stored.storedAt)&&now-stored.storedAt<=MAX_STALE_MS){
    memory.set(key,stored);
    if(now-stored.storedAt>FRESH_MS)void refresh(key,loader,storage).catch(()=>{});
    return stored.rows;
  }
  return refresh(key,loader,storage);
}

export async function clearLookupCaches(storage=globalThis.chrome?.storage?.local){
  memory.clear();inFlight.clear();
  if(!storage)return;
  const values=await storage.get(null),keys=Object.keys(values).filter(key=>key.startsWith(CACHE_PREFIX));
  if(keys.length)await storage.remove(keys);
}
