# FMCC Billing — Decisão de infraestrutura de homologação (2026-10-08)

## Evidências verificadas
- GitHub Actions `Billing PostgreSQL Isolated Certification`, execução 37847884418: sucesso, incluindo testes PostgreSQL 18 em duas conexões concorrentes.
- O PostgreSQL do Command no Render é `fmcc-preview-postgres`; **não** utilizar como banco descartável.
- Render tem `fmcc-preview-web` na `main` e `fmcc-pr31-reference`, ambos no plano gratuito.
- A conta Render não permite mais de um banco PostgreSQL gratuito ativo. A tentativa anterior de criar outro foi recusada sem custo.
- A credencial Asaas Sandbox está configurada no Render do Command, não comprovadamente disponível nos segredos do GitHub Actions.

## Decisão — manter zero custo e isolamento
1. Continuar homologação das migrações, transações, concorrência e isolamento por **PostgreSQL 18 descartável no GitHub Actions**. Nunca acessar `fmcc-preview-postgres` desses testes.
2. Não criar agora outro serviço Render sem um banco isolado correspondente: um segundo frontend ou API apontando para o PostgreSQL atual seria falso isolamento.
3. Para o ciclo Pix fim a fim, avaliar workflow **manual**, com segredo Asaas Sandbox de escopo próprio, PostgreSQL temporário e controles fail-closed. Exigir validação prévia dos dados de cliente fictício e contas de gateway; restringir estritamente a API Sandbox. Não copiar segredos do Render para logs, código ou repositório.
4. Somente depois de testes completos, decidir se uma instância persistente gratuita fora do Render é necessária para um preview navegável. Sua adoção depende de elegibilidade, limites e autorização expressa antes de criar conta ou serviço.
5. PR #63 em Draft: não fazer merge, deploy da `main`, migração de banco existente ou pagamento real.

## Gates pendentes para Pix
- Revisar criação de clientes e faturas fictícios no banco temporário e o mecanismo de webhook/consulta.
- Proteger a execução manual de pagamentos simulados com permissão explícita e impedir disparos por pull requests não confiáveis.
- Garantir rastreabilidade por tenant, SaaS, cliente, assinatura, fatura e gateway.
- Confirmar não haver qualquer endpoint ou permissão de transferências/saques.
- Coletar evidência de pagamento confirmado no Sandbox e conciliação SQL antes de declarar homologado.

Status: `POSTGRES_CI_CERTIFIED; ISOLATED_DEPLOY_NOT_CREATED; SANDBOX_PAYMENT_PENDING`.
