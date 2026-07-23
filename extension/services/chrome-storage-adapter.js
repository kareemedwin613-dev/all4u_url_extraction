export function createChromeStorageAdapter(storageArea=chrome.storage.local,prefix="supabase-auth:") {
  return { async getItem(key){return (await storageArea.get(prefix+key))[prefix+key]??null;},async setItem(key,value){await storageArea.set({[prefix+key]:value});},async removeItem(key){await storageArea.remove(prefix+key);} };
}
