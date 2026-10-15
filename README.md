# FM Command V2

Versão comercial e multi-setor do FM Command, da FM Tecnologia.

**Identificador técnico herdado:** FM Control Center / FMCC. O namespace técnico FMCC é preservado nesta fase, sem rename destrutivo. O domínio oficial da V1 é `fmcommand.com.br`; o nome e o domínio da V2 ainda serão definidos.

## Relação com a V1

- A V1 (`faabio3131/FM-CONTROL-CENTER`) continua como está, para uso da própria FM Tecnologia. Esta V2 **não altera a V1**.
- Esta V2 nasceu de uma cópia isolada da V1 no commit `18f1d1b2c9283fd7f775da97e3b7a74e3c767ada`. O README original está em `docs/V1-README.md`, e os documentos FMCC-* e FM_COMMAND_* foram mantidos como referência de arquitetura e governança.
- Os workflows de GitHub da V1 **não foram copiados**: eles apontam para ambientes, segredos e validações de produção da V1. A V2 terá os seus, criados nas fases seguintes.

## Direção da V2

Centro de comando governado para empresas que operam mais de um produto, unidade ou fonte de dados, em qualquer setor. Mantém as regras que fazem o Command confiável: dado ausente nunca vira zero, fonte e proveniência em todo número, auditoria, isolamento por cliente, IA que explica com evidência.

**Decisão (15/10/2026):** a V2 já nasce multi-setor. Nada de setor fica fixo no código: métricas, painéis e pacotes por setor são configuração, e a V1 continua sendo o uso específico da FM.

Plano de fases (ordem proposta, cada uma com aprovação do Diretor Executivo antes da seguinte):

1. **Fundação:** repositório novo, cópia isolada da V1, tema e base de gráficos.
2. **Ver:** gráficos em cada tela e painéis do cliente.
3. **Ao vivo:** números e alertas atualizam sem recarregar a página.
4. **Agir:** alertas por e-mail e WhatsApp, relatórios agendados e exportação.
5. **Abrir:** conectores para qualquer empresa e pacotes por setor.

O relatório de mercado e de lacunas que baseia esse plano é o documento "FM Command V2: Mercado e lacunas".

## Regras de trabalho

- Uma branch e um PR por tarefa. Nada de merge, deploy ou produção sem autorização expressa.
- Nunca versionar segredos nem dados reais. Variáveis de ambiente só por `.env` local e pelo provedor de hospedagem.
- Dado ausente é "Indisponível", nunca zero. Sem conversão de moeda automática.

## Desenvolvimento

```bash
npm ci
npm run typecheck
npm run lint
npm run test
```

Os testes de integração precisam de PostgreSQL local isolado e de variáveis como `BETTER_AUTH_SECRET`; sem elas, esses arquivos falham por configuração ausente, não por defeito do código. Veja `.env.example`.
