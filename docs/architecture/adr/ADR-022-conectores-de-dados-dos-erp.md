# ADR-022 — Conectores de dados dos ERPs do cliente

**Status:** PROPOSED
**Data:** 16/10/2026
**Autoridade:** FM Solution Architect, aguardando aprovação do Diretor Executivo
**Produto:** FM Command V2
**Relaciona-se:** ADR-012 (moeda), ADR-019 (unidades), ADR-020 (mercado global), arquitetura-alvo (camada de Conectores)

## Contexto

O V2 lê os ERPs que o cliente já usa (decisão do Diretor, 16/10/2026). Os sistemas diferem: o Omie usa um par de chaves no corpo de um POST JSON, limite de 240 chamadas por minuto por chave e método e 4 simultâneas; Conta Azul, Bling, Xero e QuickBooks usam OAuth 2.0, cada um com limites próprios. Nada disso pode ficar fixo no código de negócio.

## Decisão

1. **Um contrato de conector** (`Connector`: `health`, `pull(cursor)`), já existente, passa a ser a única porta. Cada ERP é um conector registrado em `connector-composition.ts`; o motor de métricas não conhece nenhum ERP.
2. **Credencial fora do código e fora da configuração da fonte.** A fonte guarda só uma referência (`secretRef`). O `CredentialStore` resolve a referência sempre com a empresa; a implementação em Postgres cifra com AES-256-GCM, chave de ambiente (`FMCC_CREDENTIAL_KEY`) e a empresa + referência como dado autenticado (linha copiada para outra empresa não decifra). O tipo da credencial é uma união (`api_key_pair`, `oauth2`): o Omie usa o primeiro; o OAuth entra com os conectores que o exigem.
3. **Limite por empresa, conector e método**, aplicado por um limitador (janela de 1 minuto + teto de simultâneas). A fonte pode só baixar o teto do conector, nunca subir.
4. **Endereço do ERP fixo no conector.** Uma fonte configurada por cliente não escolhe o destino da chamada (evita que o servidor seja usado para chamar endereços internos).
5. **Leitura incremental por cursor** (JSON validado, uma página por chamada): primeiro ciclo completo, depois só o que mudou desde o dia do ciclo anterior, com um dia de folga de fuso. Webhook é aceleração opcional futura, não o caminho principal.
6. **Erros classificados:** autenticação (não repete; a saúde da fonte vira "indisponível"), bloqueio por excesso (não repete na hora), configuração/cursor inválido (não repete), rede/5xx (repete com recuo). Mensagens de erro são fixas: nunca carregam o corpo da resposta nem a credencial.
7. **Dado do ERP entra com a unidade de origem.** O conector entrega `unitRef`; o mapa `config.unitMap` da fonte traduz para a unidade do Command. Sem mapa, o fato entra sem unidade; nunca por palpite.
8. **Ausente nunca é zero.** Campo que o ERP não entregou fica fora do fato e listado em `payload.unavailable`. Zero só quando o ERP disse zero. Dinheiro em menor unidade com a moeda da fonte.
9. **Registro que muda é atualizado.** A ingestão passa de "ignora se já existe" para "atualiza se a versão da origem for igual ou mais nova"; repetir a leitura não altera nada.

## OAuth (acréscimo de 16/10/2026)

10. **Um aplicativo OAuth do V2 por provedor** (`FMCC_OAUTH_<PROVEDOR>_CLIENT_ID/SECRET`, no ambiente). O cliente só autoriza; não copia chave. Endereços do provedor são dado (descritor), trocáveis por ambiente, só em https.
11. **Fluxo de autorização** (`POST /api/sources/{id}/oauth/start`, `GET /api/oauth/callback`): `state` aleatório de uso único e 10 minutos, guardado só como hash e preso a empresa, usuário e fonte; PKCE S256 quando o provedor usa, com o verificador cifrado. O retorno nunca ecoa `code`, `state` nem mensagem do provedor.
12. **Token no cofre, renovação com trava.** O refresh token de vários provedores é de uso único: a renovação roda dentro de uma transação com `SELECT ... FOR UPDATE` na credencial e confere de novo se outro processo já renovou. Refresh recusado (400/401) vira falha de autenticação e não apaga a credencial; sem novo refresh token na resposta vale o anterior (RFC 6749 §6).
    Limites conhecidos do OAuth (revisão independente): se a gravação do token renovado falhar depois de o provedor já ter invalidado o refresh token antigo, a conexão precisa ser refeita (o evento `credential_refresh_not_persisted` é registrado); a transação de renovação segura uma conexão do pool durante a chamada ao provedor (mitigado por uma renovação por processo e `lock_timeout` de 10 s); `save` e `attachSecretRef` não são atômicos; o `state` é consumido antes de conferir empresa e usuário.
13. **Conta Azul e Bling:** descritores existem (endereços de documentação de terceiros, não conferidos); os conectores de leitura aguardam a documentação oficial dos endpoints financeiros.

## Fora desta decisão

Conectores de leitura do Conta Azul e do Bling, Xero e QuickBooks, webhook do Omie, planilha/CSV e banco de dados, rodízio de chave de cifra, agendamento automático da sincronização, tela de configuração para o cliente.

## O que foi e o que não foi provado

**Provado (testes, com simulador e Postgres local):** paginação de 100 por página e ciclo completo → incremental; ausente nunca é zero; conversão de valor sem erro de ponto flutuante; erro de chave, bloqueio e rede tratados sem repetir o que não deve; limitador respeita 240 por minuto e 4 simultâneas; isolamento entre empresas (fonte, credencial, dados, limite); segredo ausente de erros e logs; credencial cifrada no banco e presa à empresa; unidade só entra pelo mapa; versão mais nova vence.

**Limites conhecidos (revisão independente, 16/10):** o limitador é por processo (com várias instâncias o teto de 240/min não vale; precisa de limitador compartilhado antes de escalar); a chave de cifra ainda não tem rodízio (`key_version` existe e não é usado); o `unitMap` não é validado no cadastro (unidade de outra empresa é barrada pelo banco, mas derruba a sincronização); a rota de credenciais não é atômica com a ligação da fonte; uma fonte pode apontar para a credencial de outra fonte da mesma empresa.

**Não provado:** nenhuma chamada ao Omie real. Os nomes de campo, os filtros de alteração, o texto das mensagens de erro (`faultstring`) e o mapeamento de status vêm da documentação pública e de um simulador escrito por nós. Falta uma conta de teste do Omie (a chave só o Diretor pode criar). Também não confirmado: se o Omie permite que um software de terceiros use a chave do cliente (contrato), e o formato e a assinatura dos webhooks.

## Ambiente configurável (motor declarativo, catálogo e tela)

Conectores de ERP novos são **definições** (JSON validado na carga), não código: caminho, paginação, campos, status e autenticação; o motor declarativo as executa com as mesmas garantias do Omie (cofre, limitador, permissões, idempotência, "ausente nunca é zero"). O catálogo lista o que a empresa pode conectar; a configuração por empresa (moeda, fuso, campo e mapa de filiais, limites que só baixam o teto, variáveis como id da conta) é validada em `SourceConfigurationService` e a tela `/dashboard/sources` (PT/EN) opera tudo isso: catálogo, criação, acesso (chave, par de chaves ou autorização OAuth), mapa de filiais, teste de saúde e sincronização.

Correções da revisão independente (16/10): variável não começa por ponto e `%` não entra em caminho; `POST /api/sources` não burla o catálogo com espaços; página repetida encerra a paginação e `startPage: 0` fecha certo; casas decimais por moeda (JPY 0, KWD 3), casas a mais viram ausente em vez de arredondar; limitador por credencial; PATCH não apaga variáveis obrigatórias.

**Não provado / limites:** nenhuma definição de Conta Azul, Bling, Xero ou QuickBooks foi confirmada contra a documentação oficial (entradas `planned`, não conectam); nenhum teste contra API real; ids numéricos acima de 2^53 perdem precisão no `JSON.parse`; a vírgula única ("1,234") é lida como decimal; a tela não tem teste de navegador (só tipos, lint, build e testes de serviço/rotas).

## Conta Azul e Bling: definições conferidas na documentação oficial (16/10/2026)

As duas definições foram escritas a partir das páginas oficiais (developers.contaazul.com e developer.bling.com.br), lidas pelo computador do Diretor, e não de fontes de terceiros. Isso **corrigiu** endereços que estavam errados no ADR e no código (login e token da Conta Azul; token do Bling).

| | Conta Azul | Bling |
|---|---|---|
| API | `https://api-v2.contaazul.com` | `https://api.bling.com.br/Api/v3` |
| Autorização | `https://login.contaazul.com/#/oauth/authorize?...` (parâmetros depois do `#`) | `https://www.bling.com.br/Api/v3/oauth/authorize` |
| Token | `https://api-v2.contaazul.com/oauth/token` (Basic) | `https://api.bling.com.br/Api/v3/oauth/token` (Basic) |
| PKCE | não citado (desligado) | não citado (desligado) |
| Limite oficial | 600/min e 10/s por conta | 3/s e 120 mil/dia por conta |
| Limite usado | 300/min, 4 simultâneas | 120/min, 2 simultâneas |
| Contas a receber / pagar | `/v1/financeiro/contas-a-receber` e `/contas-a-pagar`, `pagina`/`tamanho_pagina`, total em `itens_totais`, vencimento de/até obrigatório | `/contas/receber` e `/contas/pagar`, `pagina`/`limite`, sem total (página curta encerra), filtro de data de até 1 ano |
| Janela lida | vencimento de −180 a +180 dias | vencimento de −180 a +180 dias |

Motor: passou a ter `window` (intervalo de datas relativo ao dia do ciclo), `totalCountPath` (paginação pelo total de registros, com contador no cursor) e URL de autorização com parâmetros após o `#`.

**Decisões e limites desta etapa:**
- Status: Conta Azul usa `status_traduzido` (EM_ABERTO, ATRASADO, RECEBIDO, RECEBIDO_PARCIAL, PERDIDO, RENEGOCIADO); Bling usa o código numérico. No Bling, `6` (devolvido parcial) e `7` (confirmado) **não têm equivalente seguro e ficam indisponíveis** com o valor original guardado em `sourceStatus`. "Atrasado" no Bling é calculado pelo vencimento, não vem da API.
- Janela de 360 dias: títulos vencidos há mais de 180 dias ou a vencer em mais de 180 dias não entram. É um parâmetro da definição, não uma verdade do ERP.
- A especificação do Bling cita `bling.com.br` para o token; o guia (e o exemplo `curl`) usam `api.bling.com.br`. Usamos o guia; precisa ser confirmado com um aplicativo real.
- **Nada disto rodou contra a API real.** Os testes usam simuladores no formato documentado. Falta: aplicativos OAuth registrados nos dois provedores e uma conta de teste de cada.
- Conta Azul: o app de desenvolvimento usa a URL de redirecionamento `https://www.contaazul.com`; produção exige o domínio do V2 cadastrado.
