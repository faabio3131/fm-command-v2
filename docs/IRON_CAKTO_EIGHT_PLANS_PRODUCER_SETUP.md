# IRON FIT CORE — 8 ofertas Cakto e afiliados

**Estado auditado (2026-11-10):** Os 8 produtos e suas capas existem na Cakto e aparecem **INATIVOS**. Há IDs reais de 7 produtos e links de checkout publicamente identificados para 5 no catálogo `config/commercial/iron-cakto-eight-products-2026.candidate.json`. Os links que foram conferidos estão desativados. O Cakto `offer.id` do webhook ainda não foi obtido de fonte oficial: **não inferir offerId a partir da URL pública**. A integração live e a comissão na primeira parcela continuam não homologadas; vendas não autorizadas.

## Matriz comercial (centavos BRL)

| Produto | SKU | Preço | Tipo | Comissão do afiliado |
| --- | --- | ---: | --- | --- |
| IRON START Mensal | `IRON_START_M_2026` | R$147,00 | assinatura/mês | 50% somente na primeira cobrança |
| IRON START Anual | `IRON_START_Y_2026` | R$1.428,00 | assinatura/ano | 10% somente na primeira cobrança |
| IRON GROWTH Mensal | `IRON_GROWTH_M_2026` | R$297,00 | assinatura/mês | 50% somente na primeira cobrança |
| IRON GROWTH Anual | `IRON_GROWTH_Y_2026` | R$2.964,00 | assinatura/ano | 10% somente na primeira cobrança |
| IRON SCALE Mensal | `IRON_SCALE_M_2026` | R$497,00 | assinatura/mês | 50% somente na primeira cobrança |
| IRON SCALE Anual | `IRON_SCALE_Y_2026` | R$5.004,00 | assinatura/ano | 10% somente na primeira cobrança |
| IRON ENTERPRISE Mensal | `IRON_ENTERPRISE_M_2026` | R$897,00 | assinatura/mês | 50% somente na primeira cobrança |
| IRON ENTERPRISE Anual | `IRON_ENTERPRISE_Y_2026` | R$8.964,00 | assinatura/ano | 10% somente na primeira cobrança |

## Padrão de produto na Cakto

Criar **oito produtos separados**, não uma única oferta compartilhada; cada um precisa de capa e política específica de afiliado. Descrição comercial = campo `description` do catálogo (todas possuem mais de 100 caracteres). Entrega = `external`/área de membros externa, via webhook S2S/FM Command após pagamento. Não usar Cakto Members como autoridade da licença IRON.

- `type=subscription` e oferta `intervalType=month`, `interval=1` para mensal; `intervalType=year`, `interval=1` para anual, sem período de teste cobrado pela Cakto. O teste grátis do IRON é autoridade separada.
- Nome da oferta: nome exato no catálogo. Preço em BRL exato, sem preço digitado pelo comprador. Checkout individual e logo/capa correspondente.
- Cores de checkout: fundo #07172E, destaque azul #0F75E9, elementos em branco, botão de compra com texto claro; revisar legibilidade e usabilidade mobile. Não inserir métricas/depoimentos inventados.
- Título de checkout: `IRON [TIER] — [Mensal/Anual]`. Subtítulo: `Gestão da sua academia com tecnologia e inteligência, no plano contratado.` Texto de confiança: `A ativação depende da confirmação do pagamento. O acesso é gerenciado pelo IRON FIT CORE.`
- Mostrar periodicidade de renovação, valor total cobrado, política de cancelamento e termos reais. Nunca descrever anual como mensal parcelado; nunca tratar comissão única como cobrança única ao assinante.
- Não criar cupom automático, order bump ou upsell que altere valor/política sem aprovação.
- Venda atribuída ao afiliado deve render **somente UMA comissão por nova contratação**, independentemente de renovações mensais/anuais: comissionamento de renovação deve ficar desabilitado/0%. Se a Cakto não permitir bloquear comissão recorrente nativamente, **não ativar o programa** com comissões de 50%/10% até solução comprovada pelo suporte/API oficial. Nunca configurar 50% recorrente por suposição.
- Preferir aprovação MANUAL de afiliação inicialmente e deixar Vitrine pública desativada até critérios cumpridos. Para Vitrine Cakto exige R$ 5.000 em vendas anteriores; convite direto não exige esse mínimo.

## Contrato de integração com FM Command

Após criação **real** e verificada, extrair do painel/API `product.id`, `offer.id`, link oficial `https://pay.cakto.com.br/<offerId>`, periodicidade e preço. Alimentar o `FMCC_CAKTO_CHECKOUTS_JSON` no Secret/Config Runtime do FM Command, com cada objeto `{offerId,productId,checkoutUrl,amountMinor,interval}`, usando `month` ou `year`. Não criar IDs/links fictícios no código; não commit de token.

Recorrência, pagamentos e estornos: manter `FMCC_IRON_BILLING_TENANT_ID`, `FMCC_IRON_PRODUCT_ID`, webhook assinado Cakto no backend Command, assinatura ativa e licença canônica por academia. Não confundir webhook de assinatura com add-on de créditos avulsos. Validar explicitamente comissões primeiro pagamento vs renovação no ambiente oficial antes da comercialização.

**Autoridade final de licenças e cotas:** `ProductPlanVersion` publicado do backend IRON + FM Command para faturas e acordos. Quatro tiers ainda constam no manifesto de proposta (`CANDIDATE_NOT_PUBLISHED`) e precisam de transição governada e teste antes de habilitar oito checkouts.

## GATES DE PUBLICAÇÃO COMERCIAL (bloqueio padrão)

O FM Command agora só permite emissão de checkout de novas assinaturas e packs IA quando `FMCC_IRON_COMMERCIAL_SALES_ENABLED=true` estiver explicitamente configurado. O padrão **sem variável é vendas bloqueadas**; não desabilita os webhooks de assinaturas já pagas. Não configurar em produção enquanto houver produto ou link de checkout ativo indevidamente, mapeamento de Cakto/IRON pendente ou falta de certificação.

A página real de afiliados da Cakto (IRON START Anual) foi inspecionada em 10/11/2026: existe campo **Comissão (%)**, atribuição por clique, cookies e toggle de programa, mas **não apareceu controle de comissão exclusivamente na primeira cobrança**. A configuração permaneceu sem salvar e o programa continuou inativo. NÃO colocar 10% ou 50% sem prova da restrição no primeiro pagamento, pois o split de renovações seria irreversível do ponto de vista financeiro. A regra da FM Tecnologia é primeira cobrança 50% mensal / 10% anual e 0% renovações; registrar uma prova de suporte/API/painel antes de certificar.

`src/application/billing/iron-cakto-offer-binding.ts` é o contrato fail-closed que valida as 8 correspondências, preços, frequências e confirmação das comissões. Seu resultado atual é **NOT READY**, o que é esperado. Quando houver `product.id`, `offer.id` e links oficiais completos, obtenha os bindings através de `buildIronCaktoCheckoutBindings` e só então injete `FMCC_CAKTO_CHECKOUTS_JSON` via secrets no ambiente real. Nunca compartilhar segredos no GitHub.

## Evidências exigidas para fechar o cadastro

- IDs dos 8 produtos e das 8 ofertas obtidos via Cakto (não inventados).
- Screenshot/consulta de preço e periodicidade em cada checkout publicado, inclusive mobile.
- Screenshot/contrato Cakto do comissionamento de afiliado único; confirmação de 0% sobre toda renovação.
- Endpoint do webhook e eventos assinados no FM Command; teste de duplicidade, compra, estorno e assinatura.
- CI dos três repositórios IRON backend, IRON app e FM Command, migrations e deploy saudável.

Documentação API oficial: https://docs.cakto.com.br/introduction ; https://docs.cakto.com.br/api-reference/products/create ; https://docs.cakto.com.br/api-reference/offers/create . Documentação Cakto checkout: https://ajuda.cakto.com.br/pt-br/articles/75-como-realizar-a-personalizacao-do-checkout .
