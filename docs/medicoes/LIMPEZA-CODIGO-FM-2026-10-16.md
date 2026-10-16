# Limpeza do código herdado da FM (16/10/2026)

O V2 é o Command **comercial** e não tem relação com produtos da FM (Kordena, Iron Fit, AtendeVendeIA, NFCore). Este documento registra o que saiu da V2, o que ficou e o que depende de decisão do Diretor Executivo. A V1 (`FM-CONTROL-CENTER`) não foi alterada. Nenhuma tabela do banco foi apagada.

Resultado: 106 arquivos removidos (63 em `src`, 32 em `tests`, 11 em docs, scripts e workflow) e 26 editados (cerca de 15 mil linhas a menos). Typecheck, lint e testes verdes: 104 arquivos de teste, 583 testes (antes: 133 arquivos, 795 testes).

## Saiu (era só da FM)

| Grupo | O que foi removido |
|---|---|
| Conectores | Kordena (comercial, cobrança, plataforma) e Iron: conectores, serviços de controle, bootstrap de runtime, rotas `/api/integrations/kordena-commercial/*`, página `/dashboard/commercial/kordena` |
| Cobrança do Iron | Emissão, outbox de licença, matrícula do pagador, conciliação, fila e processador de webhook do Asaas, mapeamento de planos, identidade do produto, rotas `/api/billing/**/iron*` e `/api/internal/billing/iron/*` |
| Checkout piloto | Checkout piloto Asaas (rotas, tela, livro-razão do piloto) e a tela `/dashboard/billing` |
| Telas e rotas ligadas ao Kordena | Billing por produto, Recebimentos por produto (liam o plano de controle do Kordena), Infraestrutura & APIs (`/dashboard/settings/platform-integrations`) |
| Capacidade do Core | Resumo comercial do Kordena no Core (decisão A2: some) |
| Links | Item "Kordena" e "Billing" no menu, na busca, no painel e em Configurações; link de Billing/Recebimentos no produto |
| Aprovação | Aprovação de publicação comercial do Kordena (`commercial-approval`) |
| Operação | Fluxo de entrega do outbox do Iron (`.github/workflows`), três scripts de certificação do Iron e do piloto, documentos `IRON_D11_*` |
| Código de recurso por tenant | `tenant-integration-features` (só existia para mostrar o menu do Kordena) |
| Testes | 32 arquivos de teste removidos (todos testavam só código removido) e 8 editados para tirar as partes do Kordena/Iron (menu, busca, alcançabilidade de telas, composição do Core, registro de fontes, CME-09); nenhum foi apagado ou enfraquecido só para passar. O baseline da catraca de textos foi regravado (só desceu) |

## Ficou (genérico, serve ao V2)

- Motor de métricas, alertas, busca, notificações, fila de trabalho, roteador de provedores de IA, pergunta ao Core, voz parte 1.
- Organizações, unidades e permissão por unidade (ADR-019).
- Cobrança de assinatura do V2 (etapa 8: provedores, rotas, tabela de taxas).
- Cobrança canônica (serviço, autoridade por produto, atribuição de pagamento, clientes Asaas de checkout, sandbox e leitura de produção) e `domain/finance/receivables.ts`.
- Registro de fontes (`source-registry-service`, `commercial-source-resolver`) e o tempo de execução de conectores, agora **sem nenhum conector registrado**: os conectores entram na etapa 8E, Omie primeiro.
- Idiomas, perfil da empresa, catraca de textos fixos (baseline caiu de 770 para 500 textos em 39 arquivos).

## Misto: ficou por enquanto, precisa de decisão

| Item | Situação | Proposta |
|---|---|---|
| Tabelas `fmcc_billing_iron_*` e o esquema Drizzle (`billing-schema.ts`) | O código que as usava saiu, as tabelas e migrações continuam | Apagar só com ordem sua, em migração própria |
| `scripts/billing-postgres-certification.mjs` | Ainda confere as tabelas do Iron | Ajustar junto com a decisão acima |
| Painel de fontes (`dashboard/sources/source-control-panel.tsx`) | Os dois atalhos prontos (Kordena e Iron) continuam no formulário | Trocar pelo atalho do Omie na etapa 8E |
| `docs/governance/*` (CME-08, CME-09, CME-10, status de integração, configuração do tenant FM) | Documentos históricos do Command da FM, citam Kordena e Iron; o teste `cme09` lê o CME-09 | Arquivar ou apagar numa próxima rodada, com o teste ajustado |
| Fixtures de testes (nomes Kordena/Iron em dados de exemplo) | Só nomes de exemplo, sem código | Trocar por nomes neutros aos poucos |
| Saúde operacional (`operational-health`) | Passa a valer como dado do nível da empresa (exige acesso a todas as unidades), conforme a decisão A2 | Atualizar o ADR-019 se você não discordar |

## Risco conhecido

A limpeza foi feita a partir das importações do código. Referências por texto (variáveis de ambiente `FMCC_KORDENA_*` e `FMCC_IRON_*` em instalação ou na hospedagem) não são verificadas pelo teste; se alguma existir fora do repositório, ela passa a ser ignorada.
