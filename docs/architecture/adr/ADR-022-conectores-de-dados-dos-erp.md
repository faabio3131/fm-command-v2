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

## Fora desta decisão

OAuth (Conta Azul, Bling, Xero, QuickBooks), webhook do Omie, planilha/CSV e banco de dados, rodízio de chave de cifra, agendamento automático da sincronização, tela de configuração para o cliente.

## O que foi e o que não foi provado

**Provado (testes, com simulador e Postgres local):** paginação de 100 por página e ciclo completo → incremental; ausente nunca é zero; conversão de valor sem erro de ponto flutuante; erro de chave, bloqueio e rede tratados sem repetir o que não deve; limitador respeita 240 por minuto e 4 simultâneas; isolamento entre empresas (fonte, credencial, dados, limite); segredo ausente de erros e logs; credencial cifrada no banco e presa à empresa; unidade só entra pelo mapa; versão mais nova vence.

**Limites conhecidos (revisão independente, 16/10):** o limitador é por processo (com várias instâncias o teto de 240/min não vale; precisa de limitador compartilhado antes de escalar); a chave de cifra ainda não tem rodízio (`key_version` existe e não é usado); o `unitMap` não é validado no cadastro (unidade de outra empresa é barrada pelo banco, mas derruba a sincronização); a rota de credenciais não é atômica com a ligação da fonte; uma fonte pode apontar para a credencial de outra fonte da mesma empresa.

**Não provado:** nenhuma chamada ao Omie real. Os nomes de campo, os filtros de alteração, o texto das mensagens de erro (`faultstring`) e o mapeamento de status vêm da documentação pública e de um simulador escrito por nós. Falta uma conta de teste do Omie (a chave só o Diretor pode criar). Também não confirmado: se o Omie permite que um software de terceiros use a chave do cliente (contrato), e o formato e a assinatura dos webhooks.
