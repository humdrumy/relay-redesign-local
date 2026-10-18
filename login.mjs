const form=document.querySelector('#auth-form'),verifyForm=document.querySelector('#verify-form'),status=document.querySelector('#status');
async function post(path,body){
 const response=await fetch('/api/auth/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok||result.error)throw new Error(result.message||result.error?.message||'Request failed.');return result;
}
function email(){const input=form.elements.email;if(!input.reportValidity())throw new Error('Enter your invited email address.');return input.value.trim();}
async function busy(action){
 for(const button of document.querySelectorAll('button'))button.disabled=true;
 try{await action();}catch(error){status.textContent=error.message;}finally{for(const button of document.querySelectorAll('button'))button.disabled=false;}
}
async function sendCode(){
 await post('email-otp/send-verification-otp',{email:email(),type:'email-verification'});
 verifyForm.hidden=false;status.textContent='Verification code requested. Check your inbox and spam folder, then enter the code below.';
 verifyForm.elements.otp.focus();
}
async function submit(register){
 if(!form.reportValidity())return;
 await busy(async()=>{
  const data=Object.fromEntries(new FormData(form));status.textContent='Connecting…';
  const result=await post(register?'sign-up/email':'sign-in/email',{...data,...register?{name:data.email.split('@')[0]}:{},callbackURL:location.origin+'/'});
  if(register&&!result.user?.emailVerified){await sendCode();return;}
  const check=await fetch('/api/control/state');
  if(check.status===401){verifyForm.hidden=false;throw new Error('Your email needs verification. Use Send verification code below.');}
  if(!check.ok&&check.status!==404)throw new Error('The workspace could not load. Please retry.');
  const next=new URLSearchParams(location.search).get('next');
  const target=next?new URL(next,location.origin):null;
  location.assign(target?.origin===location.origin&&target.pathname==='/oauth/authorize'?target.href:'/');
 });
}
form.addEventListener('submit',event=>{event.preventDefault();submit(false);});
document.querySelector('#register').addEventListener('click',()=>submit(true));
document.querySelector('#send-code').addEventListener('click',()=>busy(sendCode));
verifyForm.addEventListener('submit',event=>{event.preventDefault();busy(async()=>{
 await post('email-otp/verify-email',{email:email(),otp:verifyForm.elements.otp.value.trim()});
 verifyForm.hidden=true;status.textContent='Email verified. Sign in with your password above.';
});});
