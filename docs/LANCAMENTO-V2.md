# FM Command V2 — checklist de lançamento (etapa 14)

Estado em 16/10/2026, sobre `main` após a mescla das etapas 1–13. **Nada foi publicado.** Lançar (publicar, deploy, ligar cobrança real, dar acesso a cliente) é decisão do Diretor Executivo; este documento só diz o que está pronto, o que depende de terceiros e o que é decisão.

Legenda: ✅ fechado e provado por teste interno · 🔌 depende de terceiro (fase final, configurável) · 🛑 decisão do Fábio.

## 1. Segurança (revisão interna)
| Item | Estado | Prova |
|---|---|---|
| Toda rota da API tem autoridade reconhecida (sessão+empresa, segredo do agendador, assinatura de webhook/autenticação ou sonda pública); rota nova sem classe quebra o teste | ✅ | `tests/security-review.unit.test.ts` |
| Rotas do agendador falham fechado sem segredo (503) e recusam segredo errado (401), comparação em tempo constante | ✅ | mesmo teste + `tests/*scheduler-route*` |
| Sondas públicas (`/api/health`, `/ready`, `/version`) sem segredo nem dado de empresa | ✅ | mesmo teste |
| Alteração vinda de outro site é recusada (checagem de `Origin` em POST/PUT/PATCH/DELETE, além do cookie SameSite) | ✅ | mesmo teste; `src/proxy.ts` |
| Cabeçalhos: nosniff, DENY de moldura, HSTS (1 ano), CSP de moldura/objeto/formulário, sem `X-Powered-By` | ✅ | mesmo teste. CSP de scripts **não** definida de propósito (exigiria nonce no Next e poderia quebrar telas); HSTS sem `includeSubDomains`/`preload` até o domínio final existir 🛑 |
| Todo dado de empresa tem `tenant_id`/`organization_id`; tabela nova sem a coluna quebra o teste (12 globais por desenho, listadas com motivo) | ✅ | `tests/tenant-column-sweep.integration.test.ts` |
| Isolamento entre empresas por funcionalidade (alertas, canais, relatórios, fontes, filiais, pacotes, assinatura…) | ✅ | testes de integração de cada etapa |
| Segredos: chave de ERP/canal só no cofre cifrado (AES-256-GCM, empresa na autenticação); audit sem chave nem endereço | ✅ | `tests/connectors-8e`, `tests/channels` |
| Dependências: `npm audit --omit=dev` mostra 4 avisos moderados, todos em `drizzle-kit` → `@esbuild-kit` → `esbuild` (servidor de desenvolvimento do esbuild). É ferramenta de migração, não roda atendendo clientes | ⚠️ aceito, ver §5 | trocar quando o drizzle-kit publicar versão sem a cadeia |
| Teste de invasão por terceiro, varredura de infraestrutura real | 🔌 | não feito |
| Limite de tentativas de login/cadastro | ✅ parcial | limite do servidor de autenticação ativo (3 cadastros/10 s); sem teste de carga |

## 2. Testes de ponta a ponta
- 813+ testes de unidade e integração (banco real PG 16), typecheck, lint (2 avisos antigos), 19 testes de navegador (pt-BR e en-US, celular nas telas que importam). Rodar tudo é o portão de lançamento; ver §6.
- Banco de CI é PG 18 (`isolated-postgres`), local é PG 16: **a primeira publicação precisa rodar a migração num PG da versão de produção**. 🔌
- Não provado: carga com muitos usuários/filiais, proxy/balanceador reais, ERP real, e-mail/WhatsApp reais.

## 3. Documentação
- Cronograma e estado por etapa: `docs/CRONOGRAMA-V2.md`; estado no Project "Sites".
- Operação: `docs/runbooks/FMCC-F21-OPERATIONS-RUNBOOK.md`. Este arquivo cobre o que a V2 acrescentou: agendador, canais, relatórios, conectores, pacotes.
- Variáveis de ambiente: `.env.example` (inclui canais, cofre, OAuth, agendador).

## 4. Agendador (o que faz "ao vivo" sem alguém clicar)
- Fluxo `.github/workflows/fmcc-alert-automation.yml` chama, nesta ordem, `/api/internal/automation/metrics/recompute`, `/alerts/evaluate`, `/reports/run` (todas idempotentes). **Agendamento desligado** até existir ambiente aprovado 🛑: para ligar, definir `FMCC_AUTOMATION_BASE_URL` (variável) e `FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET` (segredo, ≥ 32 caracteres) e descomentar `schedule`.
- Cada sincronização de conector já recalcula sozinha; o agendador cobre empresas sem sincronização recente e os relatórios na hora marcada.
- Sem o agendador, relatórios agendados **não saem** e alerta só reavalia no uso.

## 5. Procedimentos
**Primeira instalação / atualização**
1. Backup do banco antes de qualquer migração (código volta com redeploy; **banco não volta sozinho**).
2. Variáveis obrigatórias: `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `FMCC_CREDENTIAL_KEY` (32 bytes base64; **perder a chave = perder as chaves de ERP/canal guardadas**; não há rodízio ainda), `FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET`. Cognitivo: `FMCC_COGNITIVE_MODEL_*` (teto de gasto 🛑).
3. Migrações: 0000–0026 (`RUN_MIGRATIONS_ON_STARTUP=true` ou `npm run db:migrate`). O CI confere a contagem contra o diário.
4. Pós-deploy: `/api/health`, `/api/ready`, `/api/version` (SHA certo), entrar, criar empresa, abrir Fontes/Canais/Relatórios/Setores.
5. Agente piloto (resumo semanal): precisa de uma rota de IA para a tarefa `synthesis` e de um orçamento definido pelo proprietário em Agentes; sem isso fica desligado. O gasto é limitado pelo teto mensal, mas o custo real depende do preço configurado do provedor.
6. Canais simulados só com `FMCC_CHANNEL_SIMULATED=1` (+ `FMCC_CHANNEL_ALLOW_SIMULATED=1` em produção). **Em produção real, deixar desligado.**

**Reverter:** redeploy do SHA anterior. Migrações da V2 só adicionam tabelas/colunas/índices; ainda assim, não restaurar banco sem decisão.

**Incidente comum**
- Número "Indisponível" onde devia ter valor: ver Fontes (última sincronização, falha), depois se há fatos daquele tipo; indisponível é o comportamento correto sem dado.
- Relatório não saiu: canal ligado e destinatário? agendador rodando? recibo em Canais (incerto nunca é reenviado sozinho; conferir com o destinatário antes de reenviar manual).
- Sincronização falhando: tela de Fontes mostra o código público (credencial, limite do ERP, configuração); credencial revogada exige novo acesso do cliente.

## 6. Portão de lançamento (rodar sobre o commit candidato)
`npm run typecheck && npm run lint && npm run test` (banco de teste de pé), `npm run build`, testes de navegador, CI verde (`static` e `isolated-postgres`), `/api/version` conferido.

## 7. Fase final: homologação com terceiros (tudo configurável, nada no código por cliente)
1. App OAuth no Bling e na Conta Azul; conta de teste de cada ERP; chaves do Omie só no ambiente. 🔌
2. SMTP real e WhatsApp real: adaptadores prontos e provados só contra servidores falsos locais (`FMCC_SMTP_*`, `FMCC_WHATSAPP_CLOUD_API_BASE`, ver `.env.example`); formato do envio de texto, autenticação e resposta conferidos com a página oficial da API de Mensagens (v25.0, 17/10/2026); **não conferidos:** códigos de erro (usados 130429, 131056, 131047, 190) e a regra da janela de 24h, que a página não traz; falta conta SMTP real, verificação da Meta e modelos aprovados por cliente (texto livre só dentro da janela de 24h). 🔌
3. Conectores reais de TMS (transporte) e MES/PCP (indústria) mapeando ao contrato dos pacotes. 🔌
4. Revisão do inglês por pessoa nativa; pen test; PG de produção; medição de carga. 🔌
5. Cron externo ligado (§4). 🛑 (ambiente aprovado)

### 7.1 Meta de carga da fase final (PROPOSTA do agente, a confirmar pelo Diretor Executivo)
Pedido do Fábio em 17/10/2026: o teste real parte de uma meta ("N empresas perguntando ao mesmo tempo"), e o dimensionamento sai da medição. Os números abaixo são uma sugestão de partida, não uma decisão; o Fábio troca por os dele.

| Cenário | Meta proposta | Como é medido |
|---|---|---|
| Empresas ativas | 50 | volume de dados sintéticos por empresa (filiais, fatos, métricas) |
| Empresas perguntando à IA ao mesmo tempo | 20 (pico), com 3 perguntas cada | provedor real, fila e limite por empresa ligados |
| Pessoas com o painel aberto | 200 | consulta de atualização a cada 5 s ≈ 40 req/s só nessa rota |
| Filiais por empresa | até 100, 24 meses de série | custo da série mensal (uma consulta por filial e mês) |

Critérios de aprovação: painel com p95 abaixo de 1 s durante o pico de IA; pergunta à IA concluída em até 30 s no p95; nenhuma tarefa perdida; acima da meta o sistema recusa rápido (503 com aviso) em vez de ficar lento ou perder dado; gasto de IA do teste dentro do teto definido pelo Fábio.

Disponibilidade: meta de 99,9% ao mês (cerca de 43 minutos de queda por mês), o mínimo comumente citado para SaaS (fonte de benchmark sem estudo primário; confirmar antes de prometer em contrato).

Referência de mercado (pesquisa de 17/10/2026): nenhum concorrente publica capacidade de usuários simultâneos. Publicam frequência de atualização (Power BI Pro até 8 por dia; Premium até 48 por dia; Databox limita a atualização manual a 1 vez por dia por usuário nos painéis) e a nossa consulta de 5 s é bem mais fresca. O número de "empresas ativas" deve vir da meta comercial do primeiro ano, não do mercado.

Limite externo que pesa mais que o nosso servidor: a API do Omie (conforme a página de ajuda, que tem tabela inconsistente) limita a 960 requisições por minuto por IP, 240 por minuto por chave e método, 4 simultâneas e bloqueia por 30 minutos após 10 erros seguidos. Se os clientes sincronizarem pelo mesmo servidor, o limite por IP pode ser compartilhado. Medir na fase final; preferir webhook quando o ERP oferecer, guardar o resultado e espaçar consultas. Limites do Bling e da Conta Azul ainda não conferidos.

Medir também: pool de conexões do banco, atraso do laço de eventos, uso de memória, e o que acontece quando a cota do provedor é atingida (hoje devolve erro; a fila com repetição precisa estar ligada). Com os resultados, dimensionar o número de instâncias do painel e do serviço de IA (ponto de partida: 2 de cada, sem ponto único de falha) e decidir sobre um segundo provedor de reserva.

## 8. Decisões do Fábio antes de lançar
Domínio e ambiente (HSTS, `includeSubDomains`, agendador); modelo de preço e primeiro segmento; política de câmbio (soma de moedas diferentes hoje é erro, nunca soma errada); provedor e teto de gasto da IA; piloto da etapa 11; aprovar a arquitetura-alvo; coletor fiscal; limpezas pendentes (tabelas Iron, governança, ADR-019); **"pode publicar"** e **"pode ligar cobrança real"**.

## 9. Fora do escopo desta versão (para ninguém assumir que existe)
Soma por região no painel inicial (existe na tela Filiais); período livre (datas à escolha) e seletor de período fora do painel inicial e da tela Filiais; gráficos além da tela Filiais; PDF; empurrão do servidor (SSE/WebSocket); rodízio da chave do cofre.
