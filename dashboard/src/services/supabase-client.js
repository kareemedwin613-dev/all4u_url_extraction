import {createClient} from "@supabase/supabase-js";import {validateConfig} from "../shared/validation.js";
let client;
export function initializeSupabase(env=import.meta.env){const check=validateConfig(env);if(!check.valid)return {client:null,error:{code:"CONFIGURATION_MISSING",message:check.errors.join(" ")}};if(!client)client=createClient(check.config.url,check.config.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});return {client,error:null};}
