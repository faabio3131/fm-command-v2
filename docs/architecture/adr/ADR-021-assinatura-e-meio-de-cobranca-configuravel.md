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

## Correções da revisão independente (16/10/2026)

Corrigido, com teste:
- **Cobrança em dobro na retomada:** a retomada de uma criação interrompida agora é uma reserva atômica no banco (`claimResume`), com posse de 60 s (maior que 3 chamadas de 10 s) renovada antes de cada chamada ao provedor. Só um retomador fala com o provedor; os demais recebem "em andamento".
- **Empresa presa em "creating":** o cabeçalho `Idempotency-Key` passou a ser obrigatório; falta de chave/segredo do provedor é erro temporário (503), não 500.
- **Retomada usa o provedor gravado** na assinatura, não a rota de hoje.
- **Aviso perdido:** gravar a referência e reaplicar os avisos guardados acontece na mesma transação, sob uma trava por provedor+referência que serializa com o webhook; o reenvio do provedor de um aviso "unmatched" é reprocessado.
- **Pagamento sem valor não ativa** (`amount_missing`).
- **Asaas sandbox em produção** só liga com `FMCC_SAAS_ALLOW_SANDBOX=1` e só se o token do webhook existir. O simulador exige segredo próprio (16+ caracteres), sem valor padrão.
- **Corpo do webhook e da assinatura** lidos com contador de bytes (aborta ao passar do limite, inclusive em `chunked`).
- Comparação de token por hash (sem erro 503 por caracteres fora do ASCII).

Abertos (registrados, não corrigidos agora):
- O webhook do Asaas é autenticado só por token fixo; a confirmação do pagamento direto no provedor (`GET /payments/{id}`) fica para antes de produção.
- Estorno corta todo o período pago; chargeback não é tratado; juros/multa/desconto do Asaas podem gerar `amount_mismatch` (validar no sandbox).
- Cliente duplicado no Asaas em retentativa incerta; erosão do dia de vencimento em meses curtos; cancelamento de assinatura já apagada no Asaas; livro cresce com eventos de outra cobrança; endurecimentos de constraint na migração; sem link de pagamento (checkoutUrl nulo).
- O Asaas continua sem teste contra a API real.

## Taxas de cada banco, configuráveis (16/10/2026, decisão do Fábio)

A FM Tecnologia não fica presa a um provedor: escolhe o banco/PSP por moeda e país (`fmcc_saas_payment_route`) e **a tabela de taxas de cada um também é configuração**, não código. Cada banco cobra o seu valor fixo e o seu percentual para boleto, PIX, cartão etc., e isso muda com o tempo.

- Tabela `fmcc_saas_fee_schedule`: provedor + forma de pagamento (`boleto`, `pix`, `card`, `transfer`, `other`) + moeda + valor fixo + percentual (em centésimos de ponto percentual: 199 = 1,99%) + mínimo + máximo + **vigência** (a mais recente que já começou vale; reajuste futuro fica cadastrado sem valer ainda).
- `SubscriptionService.feeFor(provedor, forma, valor, moeda, quando)` estima a taxa e o líquido, em inteiros, arredondando meio para cima. A taxa nunca passa do valor cobrado.
- **Sem tabela configurada a resposta é "indisponível" (`null`), nunca taxa zero presumida.** Outra moeda não converte.
- A taxa é **estimativa**: o banco cobra de fato; a diferença aparece na conciliação.
- Nenhum valor de nenhum banco existe no código. Cadastrar ou reajustar é inserir uma linha; ainda não há tela (junto com preços e rotas, é configuração da FM).
- Os pontos "abertos" do Asaas (confirmar pagamento no provedor, estorno/chargeback, juros e multa) são do **adaptador de cada banco**: ao conectar outro banco, ele traz o seu adaptador seguindo o mesmo contrato `PaymentProvider`, sem mexer no núcleo.

## Vários provedores por rota e capacidades por provedor (16/10/2026, etapa 8C)

Decisão do Fábio: nenhum banco fixo, nem para o recebimento internacional da FM. Portanto:

- **Rotas com prioridade e reserva.** `fmcc_saas_payment_route` aceita vários provedores para a mesma moeda/país, ordenados por `priority` (menor primeiro). Para uma **nova** assinatura vale o primeiro, na ordem (rota do país antes da genérica), que: esteja ligado, esteja configurado neste ambiente, cobre a moeda e cobre sozinho a cada ciclo. Provedor desligado, não configurado ou incompatível é pulado.
- **Sem troca no meio da criação.** Depois de reservada, a assinatura fica com o provedor escolhido; repetir em outro após uma resposta incerta poderia cobrar em dobro. A reserva só vale na escolha de uma assinatura nova.
- **Assinaturas existentes não mudam** quando a rota muda. Migrar clientes antigos para outro banco exige nova autorização de cobrança do cliente (cartão e débito não são portáveis entre bancos); a migração controlada empresa por empresa **não foi construída**.
- **Capacidades no contrato** (`ProviderCapabilities`): modo de cobrança (`provider_recurring` = o provedor cobra sozinho a cada ciclo; `invoice_each_cycle` = o cliente paga cada ciclo, como boleto, PIX e métodos locais), formas de pagamento aceitas e se faz estorno. **O modo `invoice_each_cycle` está declarado, mas o fluxo ainda não existe**: nenhum provedor assim é escolhido até ele ser construído.
- **Comparação de líquido** (`compareRoutes`): para moeda/país/forma/valor, lista os provedores utilizáveis do maior líquido ao menor, com as taxas configuradas; sem taxa vai para o fim, nunca zero. Só informa; a ordem real é a prioridade da tabela de rotas.
- Mudança de comportamento: moeda não suportada por um provedor deixou de ser erro e passou a ser "pula para o próximo"; se nenhum serve, o erro é `subscription.no_payment_method`.

## Imposto sobre a venda e mercados de língua inglesa (16/10/2026)

- **Decisão do Fábio:** mercado-alvo = todos os países de língua inglesa; o **comprador paga o imposto** (preço da FM + imposto). **Quem calcula, cobra e repassa ao governo ficou para depois** (processador direto, com a FM recolhendo, ou intermediário que assume a venda). Imposto de cada país é decisão fiscal com contador e advogado (ADR-020, item 7).
- **O preço gravado na assinatura é sempre sem imposto.** O sistema não calcula imposto: quem o calcula é o provedor escolhido. `PaymentEvent.amount` é a mensalidade sem imposto (é ela que se confere com o preço) e `taxMinor` carrega o imposto cobrado, quando o provedor informa (nunca presumido zero). Cada adaptador separa mensalidade e imposto; sem isso, um pagamento com imposto seria recusado como `amount_mismatch`.
- Não há coluna de imposto no livro de eventos ainda (conciliação fiscal fica para a escolha do provedor).
- **Aberto e relevante:** a maior parte das telas do painel ainda tem texto fixo em português (49 arquivos, 770 trechos no registro da catraca de i18n) e datas em `pt-BR` com fuso de São Paulo. O inglês completo, necessário para vender nesses países, depende de traduzir as telas, e de revisão por pessoa nativa antes de cobrar clientes (ADR-020, item 6).
