"use client";

import { useState, type FormEvent } from "react";

type Academy={id:string;name:string};
type Props={productId:string;academies:Academy[];canWrite:boolean;enabled:boolean};

export function IronPayerEnrollmentPanel({productId,academies,canWrite,enabled}:Props){
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [password,setPassword]=useState("");
  const [document,setDocument]=useState("");
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [gymId,setGymId]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!canWrite||!enabled||busy||!gymId)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch(`/api/billing/products/${encodeURIComponent(productId)}/iron-license/asaas-payer`,{
        method:"POST",headers:{"content-type":"application/json"},
        cache:"no-store",
        body:JSON.stringify({gymId,name,cpfCnpj:document,email,password}),
      });
      const body=await response.json() as {status?:string};
      if(!response.ok){
        setMessage("Cadastro não confirmado. Confira o vínculo da academia e a configuração financeira com o administrador.");
      }else if(body.status==="enrolled"){
        setMessage("Pagador confirmado e vinculado à academia. Nenhuma cobrança foi criada.");
        setName("");setDocument("");setEmail("");setGymId("");
      }else{
        setMessage("Cadastro em revisão. A recuperação fará somente consultas; não será enviado outro cadastro automaticamente.");
      }
    }catch{
      setMessage("Comunicação indisponível. Consulte o status antes de qualquer nova tentativa.");
    }finally{
      setPassword("");setBusy(false);
    }
  }

  return <section className="executive-section" aria-label="Cadastro financeiro de academias IRON">
    <div className="section-heading">
      <div>
        <span className="eyebrow">IRON FIT CORE · Billing SaaS</span>
        <h2>Cadastro do pagador da academia</h2>
      </div>
      <p>Vincule o responsável financeiro da academia à conta Asaas da FM Tecnologia. Este cadastro não movimenta cobranças e não pertence ao financeiro de alunos.</p>
    </div>
    {!canWrite?<p>O cadastro financeiro exige permissão administrativa específica.</p>:
     !enabled?<p>Cadastro aguardando habilitação financeira e homologação da conta Asaas. Nenhuma solicitação será enviada ao provedor.</p>:
     academies.length===0?<p>Não há academias canônicas disponíveis. Conecte o control plane do IRON antes de cadastrar pagadores.</p>:
     <form className="product-create-form" onSubmit={event=>void submit(event)}>
       <label>Academia
         <select value={gymId} onChange={event=>setGymId(event.target.value)} required disabled={busy}>
           <option value="">Selecione a academia</option>
           {academies.map(gym=><option value={gym.id} key={gym.id}>{gym.name}</option>)}
         </select>
       </label>
       <label>Nome completo ou razão social
         <input value={name} onChange={event=>setName(event.target.value)} maxLength={150} required disabled={busy} autoComplete="organization"/>
       </label>
       <label>CPF ou CNPJ
         <input value={document} onChange={event=>setDocument(event.target.value)} maxLength={18} required disabled={busy} inputMode="numeric" autoComplete="off" aria-describedby="iron-payer-document-help"/>
         <small id="iron-payer-document-help">Com ou sem pontuação. CPF: 11 dígitos; CNPJ: 14 dígitos. A validação inclui os dígitos verificadores.</small>
       </label>
       <label>E-mail financeiro (opcional)
         <input type="email" value={email} onChange={event=>setEmail(event.target.value)} maxLength={254} disabled={busy}/>
       </label>
       <label>Senha de confirmação do administrador
         <input type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="current-password" required disabled={busy}/>
       </label>
       <button className="button" type="submit" disabled={busy||!gymId}>
         {busy?"Validando…":"Validar e cadastrar pagador"}
       </button>
       <p>Em caso de falha ou timeout, novas solicitações apenas consultarão o Asaas. Duplicidades exigem revisão humana.</p>
     </form>
    }
    {message?<p role="status">{message}</p>:null}
  </section>;
}
