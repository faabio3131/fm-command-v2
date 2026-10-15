# AGENTS.md — como o trabalho de construção da V2 é executado

Este arquivo vale para qualquer agente (ou pessoa) que trabalhe neste repositório. O plano de etapas está em `docs/CRONOGRAMA-V2.md`.

## Autorização permanente do Diretor Executivo (15/10/2026)

- Teste verde: o agente segue para a próxima etapa do cronograma sem pedir nova autorização.
- Teste vermelho: o agente corrige a causa e segue quando ficar verde.

Isso vale apenas dentro dos limites abaixo. Fora deles, o agente para e pergunta.

## O ciclo de cada etapa

1. Ler a etapa em `docs/CRONOGRAMA-V2.md` e abrir uma branch a partir da etapa anterior (PRs empilhados, um por etapa).
2. Escrever o código e os testes juntos.
3. Rodar `npm run typecheck`, `npm run lint`, `npm run test` e, quando a etapa mexer em telas, `npm run build`.
4. **Verde:** commit, push, PR (base na branch da etapa anterior), marcar a etapa no cronograma e seguir para a próxima.
5. **Vermelho:** achar a causa, corrigir e rodar de novo. Depois de 3 ciclos sem resolver a mesma causa, parar e relatar.
6. Etapas que mexem em isolamento entre empresas ou unidades, em dinheiro ou em segurança passam por revisão de um segundo agente, que não escreveu o código, antes de abrir o PR.
7. Ao fim de cada etapa, um relatório curto ao Diretor Executivo: o que ficou pronto, o que os testes provam, o que não foi provado.

## Nunca, sem autorização expressa na hora

- Mesclar em `main`, publicar, fazer deploy ou tocar produção.
- Criar recurso pago, contratar serviço, gastar dinheiro ou usar chave real de provedor (IA, cobrança, WhatsApp, e-mail).
- Usar dado real de cliente. Testes usam dados sintéticos.
- Rodar migração em banco que não seja local ou de teste.
- Escolher preço, plano, provedor definitivo, nome ou domínio da V2, ou tomar decisão jurídica ou fiscal.
- Lançar em um país novo (a regra do mercado global exige aprovação por país).
- Alterar a V1 (`FM-CONTROL-CENTER`), que segue para uso da FM.
- Versionar segredo, chave, token ou `DATABASE_URL`.

## Nunca, mesmo com o teste vermelho

- Apagar, enfraquecer ou pular um teste só para ficar verde. Teste errado se corrige com justificativa no PR; teste certo manda no código.
- Silenciar erro de tipo ou de lint (`any`, `ts-ignore`, desligar regra) para passar.
- Dar um número como verdadeiro sem medir. O que não foi medido é dito como não medido.

## Quando parar e perguntar

- Falha de teste cuja causa é uma decisão de produto, e não um defeito.
- Duas leituras razoáveis de um requisito, com custo alto de refazer.
- Qualquer etapa marcada 🛑 no cronograma.
- Dado, chave ou acesso que falta e que só o Diretor Executivo pode dar.

## Regras de produto que valem em todo código

1. Web desde o início: nada de versão local ou mobile para migrar depois.
2. Dado ausente é "Indisponível", nunca zero. Dinheiro em menor unidade, sempre com moeda; sem conversão automática (ADR-012).
3. Texto de interface em arquivos de tradução (pt-BR e en-US no mínimo), nunca no código (ADR-020).
4. A operação do cliente nunca depende da IA (ADR-016). A escolha de provedor é da política, nunca de uma IA (ADR-017).
5. Ação que altera estado exige confirmação humana. Todo agente tem orçamento de passos, tokens e tempo.
6. Provedores de IA e de cobrança são configuráveis sem mudar código.
7. Kordena se escreve sempre com K.
8. Cada etapa deixa registrado o que foi e o que não foi provado.
