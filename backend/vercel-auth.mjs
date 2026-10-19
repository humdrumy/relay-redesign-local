import { createAuthServer, extractNeonAuthCookies, serializeSetCookie, handleAuthProxyRequest } from '@neondatabase/auth/server';

export const allowedEmails = env => new Set((env.RELAY_ALLOWED_EMAILS || '').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
export function authConfig(env) {
  if (!env.NEON_AUTH_BASE_URL || !env.NEON_AUTH_COOKIE_SECRET || env.NEON_AUTH_COOKIE_SECRET.length < 32) throw new Error('Authentication is not configured');
  return {baseUrl:env.NEON_AUTH_BASE_URL,cookieSecret:env.NEON_AUTH_COOKIE_SECRET,sameSite:'lax',sessionDataTtl:60};
}
export async function resolveWebUser(request, env) {
  const cookies=[];
  if(!request.headers.get('cookie'))return {subject:null,cookies};
  const auth=createAuthServer({...authConfig(env),context:()=>({
    getCookies:()=>extractNeonAuthCookies(request.headers.get('cookie')||''),
    setCookie:(name,value,options)=>cookies.push(serializeSetCookie({name,value,...options})),
    getHeader:name=>name.toLowerCase().startsWith('x-neon-')?null:request.headers.get(name),
    getOrigin:()=>new URL(request.url).origin,getFramework:()=> 'relay-vercel'
  })});
  const session=await auth.getSession({query:{disableCookieCache:'true'}});
  const user=session.data?.user;
  if(!user || user.emailVerified!==true || !allowedEmails(env).has(user.email?.toLowerCase()))return {subject:null,cookies};
  // Relay currently has a single human administrator role. Both explicitly
  // allowed, verified accounts administer the same workspace.
  return {subject:'relay-owner',email:user.email,cookies};
}
export async function handleWebAuth(request,env){
  const url=new URL(request.url),path=url.pathname.slice('/api/auth/'.length);
  if(!['GET','POST'].includes(request.method))return new Response(null,{status:405});
  if(request.method==='POST' && request.headers.get('origin')!==url.origin)return Response.json({message:'Use the same-origin login form.'},{status:403});
  if(['sign-up/email','sign-in/email','request-password-reset','send-verification-email','email-otp/send-verification-otp','email-otp/verify-email'].includes(path)&&request.method==='POST'){
    if(Number(request.headers.get('content-length')||0)>8192)return new Response(null,{status:413});
    let body;try{const text=await request.clone().text();if(text.length>8192)return new Response(null,{status:413});body=JSON.parse(text);}catch{return new Response(null,{status:400});}
    if(!allowedEmails(env).has(String(body.email||'').toLowerCase()))return Response.json({message:'This email is not invited to Relay.'},{status:403});
    if(path==='email-otp/send-verification-otp'&&body.type!=='email-verification')return Response.json({message:'Use email verification.'},{status:400});
  }
  const permitted=new Set(['sign-up/email','sign-in/email','sign-out','get-session','verify-email','send-verification-email','request-password-reset','reset-password','email-otp/send-verification-otp','email-otp/verify-email']);
  if(!permitted.has(path))return new Response(null,{status:404});
  return handleAuthProxyRequest({request,path,...authConfig(env)});
}
