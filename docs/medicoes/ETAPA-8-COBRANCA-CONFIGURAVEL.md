# Etapa 8 — Assinatura e meio de cobrança configurável

**Data:** 15/10/2026 · **Decisão de arquitetura:** ADR-021 · **Testes:** `subscription-domain.unit`, `subscription.integration`, `asaas-payment-provider.unit`

## Leia primeiro
- **Nada foi cobrado e nenhuma conta foi usada.** Os testes usam o provedor simulado e, para o Asaas, um transporte de mentira. O adaptador do Asaas **não foi exercitado contra a API real** (não há conta de teste nesta etapa) e só existe para o ambiente de teste (sandbox) da Asaas.
- **Não há preços reais.** Nenhum plano é criado pelas migrações. Os preços e o primeiro provedor em produção são decisões do Diretor.
- **Não há tela de contratação nem bloqueio de uso** por falta de pagamento. O estado da assinatura e a pergunta "esta empresa tem direito de uso agora?" existem e estão testados.

## O que foi entregue
- **Contrato único** de meio de cobrança; **Asaas** (BRL, sandbox) e **simulador** como implementações.
- **Rota por moeda/país no banco**: trocar de provedor é atualizar uma linha. Testado: a próxima assinatura vai para outro provedor sem mudar código, a rota do país vence a da moeda, rota desligada ou provedor ausente recusa, moeda não suportada pelo provedor recusa.
- **Planos com preço por moeda e país**, sem conversão. Cada empresa vê o preço da moeda do seu perfil; sem preço na moeda não há oferta. O preço fica gravado na assinatura.
- **API**: `GET/POST/DELETE /api/subscription` (permissões de cobrança do papel) e `POST /api/webhooks/payments/{provedor}` (sem sessão; autenticidade verificada pelo provedor, corpo máximo 64 KB).
- **Ciclo de vida** e **direito de uso** (carência de 3 dias; cancelada vale até o fim do período pago).

## Garantias testadas
- Aviso repetido, inclusive 6 em paralelo, estende o período uma vez.
- Assinatura falsa ou de outro provedor: recusada (401). Valor ou moeda diferentes do preço gravado: não ativa.
- Aviso de uma empresa nunca altera outra. Permissões: visualizador e analista não contratam nem cancelam.
- Resposta perdida do provedor depois de criar: não cria de novo (1 POST só), recupera pela nossa referência.
- Aviso que chega antes de a referência estar gravada é guardado e reaplicado.
- Uma assinatura viva por empresa; mesma chave de idempotência devolve a mesma.
- Mudar o preço no catálogo não altera quem já assina.

## Limites conhecidos
- Pagamento recebido depois do cancelamento fica registrado como ignorado e precisa de conferência humana; sem tela para isso.
- Sem reembolso, disputa, nota fiscal ou imposto por país.
- A hora de cada evento é a do recebimento; inversões de chegada no mesmo instante podem reordenar.
- O `checkoutUrl` do Asaas fica vazio na criação (o link da primeira cobrança só existe depois); a tela de contratação terá de buscá-lo.

## O que preciso de você (🛑)
1. Preços e planos (valor por moeda e periodicidade).
2. Conta Asaas de teste (sandbox) para eu exercitar o adaptador de verdade, e, mais adiante, a de produção e o primeiro cliente.
3. Se haverá outro meio de cobrança para fora do Brasil (a moeda USD/EUR ainda não tem provedor real).
