import {normalizeError} from "../shared/errors.js";

export async function getSession(client){
  const {data,error}=await client.auth.getSession();
  if(error)throw normalizeError(error,"Unable to restore your session.");
  return data.session;
}

export async function signIn(client,email,password){
  const {data,error}=await client.auth.signInWithPassword({email:email.trim(),password});
  if(error){
    if(/invalid login credentials/i.test(error.message))throw {code:"AUTH_INVALID_CREDENTIALS",message:"The email or password is incorrect.",retryable:false};
    throw normalizeError(error,"Unable to sign in.");
  }
  return data.session;
}

export async function signUp(client,{email,password,fullName}){
  const name=String(fullName||"").trim();
  const {data,error}=await client.auth.signUp({
    email:String(email||"").trim(),
    password,
    options:{data:{full_name:name}},
  });
  if(error){
    const raw=String(error.message||"");
    if(/already registered|already been registered|user already exists/i.test(raw)){
      throw {code:"AUTH_EMAIL_TAKEN",message:"An account with this email already exists. Sign in instead.",retryable:false};
    }
    if(/signups not allowed|signup is disabled|email signups are disabled/i.test(raw)){
      throw {code:"AUTH_SIGNUP_DISABLED",message:"Self-registration is disabled in Supabase Auth. Ask an administrator to enable email sign-ups.",retryable:false};
    }
    if(/password/i.test(raw)){
      throw {code:"AUTH_WEAK_PASSWORD",message:raw||"Choose a stronger password.",retryable:false};
    }
    throw normalizeError(error,"Unable to create your account.");
  }
  if(data.session)return {session:data.session,needsEmailConfirmation:false};
  return {
    session:null,
    needsEmailConfirmation:true,
    message:"Registration received. Confirm your email if required, then sign in. An administrator must assign a role before you can use the workspace.",
  };
}

export function passwordResetRedirectUrl(locationLike=globalThis.location){
  const origin=String(locationLike?.origin||"").replace(/\/+$/,"");
  const path=String(locationLike?.pathname||"/")||"/";
  return `${origin}${path==="/"?"":path.replace(/\/+$/,"")}/`;
}

export async function requestPasswordReset(client,email,locationLike=globalThis.location){
  const address=String(email||"").trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)){
    throw {code:"VALIDATION_ERROR",message:"Enter a valid email address.",retryable:false};
  }
  const {error}=await client.auth.resetPasswordForEmail(address,{
    redirectTo:passwordResetRedirectUrl(locationLike),
  });
  if(error)throw normalizeError(error,"Unable to send a password reset email.");
  return {
    message:"If an account exists for that email, a reset link was sent. Check your inbox and spam folder.",
  };
}

export async function updatePassword(client,password){
  const next=String(password||"");
  if(next.length<8)throw {code:"AUTH_WEAK_PASSWORD",message:"Password must be at least 8 characters.",retryable:false};
  const {data,error}=await client.auth.updateUser({password:next});
  if(error){
    const raw=String(error.message||"");
    if(/password/i.test(raw))throw {code:"AUTH_WEAK_PASSWORD",message:raw||"Choose a stronger password.",retryable:false};
    throw normalizeError(error,"Unable to update your password.");
  }
  return data.user;
}

export async function signOut(client){
  const {error}=await client.auth.signOut();
  if(error)throw normalizeError(error,"Unable to sign out.");
}
