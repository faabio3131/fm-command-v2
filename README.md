# FM Command V2

Versão comercial e multi-setor do FM Command, da FM Tecnologia.

**Identificador técnico herdado:** FM Control Center / FMCC. O namespace técnico FMCC é preservado nesta fase, sem rename destrutivo. O domínio oficial da V1 é `fmcommand.com.br`; o nome e o domínio da V2 ainda serão definidos.

## Relação com a V1

- A V1 (`faabio3131/FM-CONTROL-CENTER`) continua como está, para uso da própria FM Tecnologia. Esta V2 **não altera a V1**.
- Esta V2 nasceu de uma cópia isolada da V1 no commit `18f1d1b2c9283fd7f775da97e3b7a74e3c767ada`. O README original está em `docs/V1-README.md`, e os documentos FMCC-* e FM_COMMAND_* foram mantidos como referência de arquitetura e governança.
- Os workflows de GitHub da V1 **não foram copiados**: eles apontam para ambientes, segredos e validações de produção da V1. A V2 terá os seus, criados nas fases seguintes.

**Antes de qualquer trabalho, leia `docs/V2-VISAO-E-DECISOES.md`** (o que o V2 é, decisões do Diretor, estado e pendências) e `docs/ARQUITETURA-ALVO-V2.md` (a fundação que não pode ser perdida).

## Direção da V2

Centro de comando governado para empresas que operam mais de um produto, unidade ou fonte de dados, em qualquer setor. Mantém as regras que fazem o Command confiável: dado ausente nunca vira zero, fonte e proveniência em todo número, auditoria, isolamento por cliente, IA que explica com evidência.

**Decisão (15/10/2026):** a V2 já nasce multi-setor. Nada de setor fica fixo no código: métricas, painéis e pacotes por setor são configuração, e a V1 continua sendo o uso específico da FM.

**Decisão (15/10/2026): estrutura multi-filial.** A V2 trata matriz, filiais e regiões como requisito central, para atender empresas como transportadoras e indústrias com unidades pelo país. A hierarquia de unidades e a permissão por unidade entram na Fase 1; consolidação, ranking entre filiais e filtro por região entram na Fase 2; conectores e pacotes para transporte e indústria entram na Fase 5. Várias moedas, SSO, banco dedicado por cliente e teste de volume são exigências de empresa grande e precisam ser validados antes de prometer a clientes desse porte.

**Decisão (15/10/2026): mercado global.** A V2 nasce pronta para português e inglês e para vários países: textos em arquivos de tradução, moeda, fuso e formatos por configuração, cobrança por provedor configurável (o Asaas é um provedor entre outros), IA por provedor configurável e região de dados escolhida por cliente. A venda internacional é online, em autoatendimento. O lançamento em cada país depende de aprovação do Diretor Executivo. A regra completa está no documento "Fundamentos e governança de construção de software FM".

Plano de fases (ordem proposta, cada uma com aprovação do Diretor Executivo antes da seguinte):

1. **Fundação:** repositório novo, cópia isolada da V1, tema e base de gráficos, mais a hierarquia de unidades (matriz, filiais e regiões) e a permissão por unidade.
2. **Ver:** gráficos em cada tela e painéis do cliente, com consolidação e comparação entre filiais.
3. **Ao vivo:** números e alertas atualizam sem recarregar a página.
4. **Agir:** alertas por e-mail e WhatsApp, relatórios agendados e exportação.
5. **Abrir:** conectores para qualquer empresa e pacotes por setor.

O cronograma de execução de 0 a 100% está em `docs/CRONOGRAMA-V2.md` e as regras de execução dos agentes em `AGENTS.md`.

A arquitetura proposta do core cognitivo da V2 está em `docs/architecture/V2-ARQUITETURA-CORE.md`, com as decisões em `docs/architecture/adr/` (ADR-015 a ADR-020, ainda PROPOSED).

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
