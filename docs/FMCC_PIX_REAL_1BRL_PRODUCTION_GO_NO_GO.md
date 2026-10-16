# FM Command — piloto Pix real R$ 1,00 — gate operacional

Status: **PREPARAÇÃO APENAS / NÃO EXECUTAR COBRANÇA**.

## Escopo
- Branch: `feat/central-billing-attribution-20261008`, PR #63, sem merge.
- Produção Asaas: credencial somente no gerenciador de segredos, nunca no repositório.
- Fatura imutável piloto: `a51a5000-1990-4000-8000-000000000001`.
- Referência externa Asaas: `fmcc-kordena-real-pix-001-20261008`.
- Valor: BRL 1,00 (100 centavos); método PIX; produto Kordena.
- Nunca utilizar PostgreSQL efêmero para registrar emissão real.

## Gates obrigatórios antes do primeiro POST /payments
1. Backup verificável e ensaio de restauração do PostgreSQL persistente, sem alterar o banco atual.
2. Migrações de billing aprovadas e implantadas de forma controlada no banco persistente, com rollback documentado.
3. Identidades canônicas reais do tenant, produto Kordena, cliente de teste, assinatura e gateway Asaas produção, verificadas por operador.
4. Fatura canônica de 100 centavos criada previamente sob os vínculos acima, em estado `pending`. A criação dessa fatura exige plano de mudança independente, com aprovação humana.
5. Executar `scripts/billing-production-pilot-readiness.mjs` SOMENTE COM conexão persistente conferida e com `FMCC_PILOT_READ_ONLY=CONFIRM_READ_ONLY` e `FMCC_PILOT_BACKUP_VERIFIED=YES`. O script só faz SELECT; o campo de backup é declaração operacional, não prova automática.
6. Consulta do Asaas por `externalReference` deve retornar lista vazia e consulta funcional. Resposta inesperada/falha bloqueia criação.
7. Autorização humana específica por execução, com controle de acesso e log de auditoria. Não transformar string de autorização no único controle.
8. Executor de produção separado, com proteção de ambiente, credenciais em segredo e concorrência serializada. Não rodar script de produção a partir de CI com PostgreSQL descartável.
9. Antes de disparar, verificar se o Asaas permite cobrança PIX no valor proposto e os dados do beneficiário.
10. Após a criação, registrar imediatamente ID de pagamento. Se ocorrer timeout após POST, NÃO repetir POST; pesquisar pelo identificador/referência e investigar.
11. Pagamento manual via app bancário apenas após conferir beneficiário e QR Code; validar confirmação Asaas e conciliar por transação.
12. Registrar auditoria, evidência e resultado sem credenciais/dados privados.

## Recuperação
- `creating` sem payment ID: não refazer POST; investigar provider por referência e recuperar apenas ID confiável.
- `payment_pending`: consultar provider; jamais marcar pago sem status verificado.
- Repetição com payment ID divergente: conflito e investigação.
- Falha ao persistir confirmação: reexecutar somente GET + operação transacional idempotente.

## Bloqueios atuais
- O banco ativo não passou por backup/restauração e migração de billing homologados neste piloto.
- O executor protegido e autorizado de produção ainda não foi criado.
- Não há fatura de produção provisionada e verificada no banco persistente.
- Nenhum Pix real foi criado. A promoção para produção permanece negada.
