# ADR-021 — Assinatura do FM Command e meio de cobrança configurável

**Status:** PROPOSED
**Data:** 15/10/2026
**Autoridade:** FM Solution Architect, aguardando aprovação do Diretor Executivo
**Produto:** FM Command V2
**Relaciona-se:** ADR-012 (moeda), ADR-017 (provedores configuráveis), ADR-020 (mercado global)

## Contexto

Para cobrar clientes, o FM Command V2 precisa de planos, preço por moeda e país, assinatura com ciclo de vida e um meio de cobrança que possa ser trocado sem mexer no código de negócio. A cobrança que existe na V1 (`fmcc_billing_*`, Asaas) é do Iron Fit: licenciamento de outro produto pela plataforma. Ela continua intacta; misturar as duas acoplaria a assinatura do FM Command às regras de licença do Iron.

## Decisão

1. **Camada nova e separada** (`fmcc_saas_*`, `domain/subscription`, `application/subscription`). Nenhuma tabela ou rota da cobrança do Iron foi alterada.
2. **Contrato único de meio de cobrança** (`PaymentProvider`): criar cliente, criar assinatura, procurar assinatura pela nossa referência, cancelar, e autenticar/normalizar o aviso (webhook). Asaas e o simulador são implementações. O resto do sistema só conhece o contrato.
3. **Escolha por configuração no banco**: `fmcc_saas_payment_route` liga moeda (e, opcionalmente, país) a um provedor. A rota do país vence a da moeda. Trocar o provedor de uma moeda é atualizar uma linha; assinaturas existentes continuam no provedor em que nasceram. O provedor só existe no processo se o ambiente trouxer a configuração dele.
4. **Preço por moeda e país, sem conversão** (ADR-012): `fmcc_saas_plan_price`. A empresa vê o preço da moeda do seu perfil; sem preço naquela moeda, o plano não é oferecido. O preço fica **gravado na assinatura**; mudar a tabela não altera quem já assinou.
5. **Ciclo de vida**: `creating → pending → active ⇄ past_due → cancelled` (e `failed`). Direito de uso: ativa/em atraso até o fim do período pago + 3 dias de carência; cancelada até o fim do período pago; pendente não tem direito.
6. **Dinheiro só entra por aviso autenticado e conferido**: pagamento confirmado só ativa se valor e moeda forem exatamente os do preço gravado; caso contrário o evento fica registrado como `amount_mismatch` e nada muda. A empresa é sempre a da assinatura que NÓS gravamos, nunca a do aviso.
7. **Nunca repetir POST às cegas**: a assinatura é reservada no banco antes de falar com o provedor; resposta incerta deixa `creating`; a repetição com a mesma chave procura primeiro pela nossa referência no provedor. Uma assinatura viva por empresa (índice único).
8. **Avisos idempotentes** (livro `fmcc_saas_event`, único por provedor+evento, na mesma transação da mudança). Aviso que chega antes de a referência estar gravada é guardado e reaplicado quando ela for gravada. No Asaas, `CONFIRMED` e `RECEIVED` do mesmo pagamento valem um evento só.
9. **Asaas somente em sandbox nesta etapa**, de propósito: não existe caminho de produção no código. Produção é decisão do Diretor (conta, chaves, primeiro cliente).

## Consequências

- Trocar ou acrescentar um meio de cobrança (outro país) é implementar o contrato e inserir uma rota; sem mudar serviço, rotas ou telas.
- O adaptador do Asaas foi escrito pela documentação e pelo cliente de sandbox da V1, e testado só com transporte simulado. **Não foi exercitado contra a API real.**
- Ainda não há tela de contratação, bloqueio de uso por falta de pagamento, nota fiscal nem impostos por país. O estado e a pergunta "tem direito de uso?" existem; aplicá-los é trabalho posterior.

## Riscos e mitigação

- Aviso que muda o estado errado: mitigado por assinatura gravada por nós, conferência de valor/moeda e livro idempotente.
- Dois avisos fora de ordem: eventos de atraso/estorno mais antigos que o último aplicado são ignorados; pagamento confirmado nunca é descartado por idade. A hora do evento é a de recebimento, não a do provedor; uma inversão de chegada dentro do mesmo instante pode reordenar.
- Pagamento que chega depois de a empresa cancelar fica registrado como `ignored_state`: exige conferência humana (reembolso). Não há tela para isso ainda.
- Corrida entre duas requisições com a mesma chave: a segunda recebe "em andamento" por 30 s; depois disso a criação é considerada interrompida e retomada.

## Condições de revisão

Segundo provedor real em produção; tributação por país; reembolso e disputa de pagamento; planos por assento ou por uso.
