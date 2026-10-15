import type { AsaasCheckoutClient, AsaasCustomer } from "./asaas-checkout-client";
import type { IronPayerClaim, PostgresIronPayerEnrollment } from "./postgres-iron-payer-enrollment";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validCpf(d:string):boolean {
  if(d.length!==11||/^(\d)\1+$/.test(d))return false;
  for(let size=9;size<=10;size++){
    const sum=d.slice(0,size).split("").reduce((s,n,i)=>s+Number(n)*(size+1-i),0);
    const digit=((sum*10)%11)%10;
    if(digit!==Number(d[size]))return false;
  }
  return true;
}
function validCnpj(d:string):boolean {
  if(d.length!==14||/^(\d)\1+$/.test(d))return false;
  for(const [size,weights] of [
    [12,[5,4,3,2,9,8,7,6,5,4,3,2]],
    [13,[6,5,4,3,2,9,8,7,6,5,4,3,2]],
  ] as const){
    const sum=d.slice(0,size).split("").reduce((s,n,i)=>s+Number(n)*weights[i],0);
    const remainder=sum%11;
    if(Number(d[size])!==(remainder<2?0:11-remainder))return false;
  }
  return true;
}

export function normalizeIronPayerIdentity(input:{
  gymId:string;name:string;cpfCnpj:string;email?:string;
}){
  if(!UUID.test(input.gymId))throw new Error("billing.iron_payer_gym_invalid");
  const document=input.cpfCnpj.replace(/\D/g,"");
  if(!validCpf(document)&&!validCnpj(document))throw new Error("billing.iron_payer_document_invalid");
  const name=input.name.trim();
  if(name.length<3||name.length>150||/[<>\x00-\x1f]/.test(name)){
    throw new Error("billing.iron_payer_name_invalid");
  }
  const email=input.email?.trim().toLowerCase();
  if(email!==undefined && (email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))){
    throw new Error("billing.iron_payer_email_invalid");
  }
  return {gymId:input.gymId.toLowerCase(),name,cpfCnpj:document,...(email?{email}:{})};
}

/** A durable claim is created once; subsequent operator requests are read-only recovery. */
export class GovernedIronPayerEnrollment {
  constructor(
    private readonly repo:Pick<PostgresIronPayerEnrollment,"reserve"|"confirm"|"markUncertain">,
    private readonly provider:Pick<AsaasCheckoutClient,
      "findCustomers"|"findCustomersByDocument"|"customerById"|"createIronPayerOnce">,
  ){}

  private async uniqueVerified(reference:string,document:string):Promise<AsaasCustomer|null>{
    const matches=await this.provider.findCustomers(reference);
    if(matches.length>1)throw new Error("billing.iron_payer_provider_duplicate");
    if(matches.length===0)return null;
    const full=await this.provider.customerById(matches[0].id);
    if(!full||full.id!==matches[0].id||full.externalReference!==reference||
       full.cpfCnpj?.replace(/\D/g,"")!==document){
      throw new Error("billing.iron_payer_provider_identity_mismatch");
    }
    return full;
  }

  async enroll(input:{
    tenantId:string;productId:string;gymId:string;name:string;cpfCnpj:string;email?:string;
  }){
    const person=normalizeIronPayerIdentity(input);
    const claim=await this.repo.reserve(input.tenantId,input.productId,person.gymId);
    // Even an already-confirmed claim must match the submitted legal identity;
    // otherwise an operator could silently swap payer documents.
    if(claim.status==="blocked")throw new Error("billing.iron_payer_manual_review_required");
    try{
      const recovered=await this.uniqueVerified(claim.reference,person.cpfCnpj);
      if(recovered){
        if(claim.providerCustomerId && claim.providerCustomerId!==recovered.id){
          throw new Error("billing.iron_payer_provider_identity_mismatch");
        }
        await this.repo.confirm(claim,recovered.id);
        return {status:"enrolled" as const,source:claim.created?"existing":"recovered",
          customerId:recovered.id};
      }
      if(claim.status==="enrolled" || claim.providerCustomerId){
        throw new Error("billing.iron_payer_provider_missing");
      }
      // Never POST on a previously reserved or uncertain claim, regardless of
      // timeout history or a second operator's request.
      if(!claim.created||claim.status!=="reserved")return {status:"manual_review_required" as const};

      const documentMatches=await this.provider.findCustomersByDocument(person.cpfCnpj);
      if(documentMatches.length!==0){
        // Another product/customer may own this legal document. A human must
        // resolve it; never take over the record based on CPF/CNPJ alone.
        throw new Error("billing.iron_payer_document_already_registered");
      }
      // Only the first successfully committed reservation may POST once.
      const customerId=await this.provider.createIronPayerOnce({
        reference:claim.reference,name:person.name,cpfCnpj:person.cpfCnpj,email:person.email,
      });
      const verified=await this.provider.customerById(customerId);
      if(!verified||verified.id!==customerId||
         verified.externalReference!==claim.reference||
         verified.cpfCnpj?.replace(/\D/g,"")!==person.cpfCnpj){
        throw new Error("billing.iron_payer_post_unverified");
      }
      await this.repo.confirm(claim,customerId);
      return {status:"enrolled" as const,source:"created" as const,customerId};
    }catch(error){
      // No secrets, names or legal documents in status ledger or logs.
      await this.repo.markUncertain(claim,"ENROLLMENT_REQUIRES_REVIEW");
      if(error instanceof Error && error.message.startsWith("billing.iron_payer_")){
        throw error;
      }
      return {status:"manual_review_required" as const};
    }
  }
}
