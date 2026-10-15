# ADR-020 — Mercado global: idiomas, moeda, fuso e região

**Status:** PROPOSED
**Data:** 15/10/2026
**Autoridade:** FM Solution Architect, aguardando aprovação do Diretor Executivo
**Produto:** FM Command V2 (regra proposta para todos os SaaS da FM)

## Contexto

O Diretor Executivo decidiu em 15/10/2026 que a FM não produz software apenas para o mercado brasileiro e quer vender também em inglês, online e em autoatendimento, como fazem fornecedores estrangeiros que usamos.

## Decisão

1. Todo texto da interface, dos e-mails, dos alertas e dos relatórios fica em arquivos de tradução, nunca no código. Português e inglês no mínimo.
2. Cada empresa cliente tem um perfil com idioma, país, moeda, fuso e formato de datas e números. Cada usuário escolhe o seu idioma (padrão pelo navegador, troca pelo seletor, salvo na conta), e o texto gerado pela IA segue o idioma de cada pessoa.
3. A região dos dados é escolhida por cliente.
4. O que é específico de um país (Pix, boleto e nota fiscal no Brasil; cartão e imposto sobre venda em outros países) fica em módulos que se ligam por configuração.
5. O site de divulgação tem endereços separados por idioma.
6. A tradução automática serve para começar; o texto de venda e de tela em inglês é revisado por pessoa nativa antes de ir a clientes pagantes.
7. Questões jurídicas e fiscais da venda no exterior passam por advogado e contador.

Padrões assumidos, que podem ser trocados: primeiro produto global é o Command V2, primeiro mercado são os Estados Unidos, modelo de venda é autoatendimento com cartão. O lançamento em cada país depende de aprovação do Diretor Executivo.

## Padrões web adotados

Estes padrões valem para todo código novo da V2 e são verificados por testes (`tests/core-contracts.unit.test.ts`).

- Idioma: etiquetas BCP 47 (`pt-BR`, `en-US`), texto em UTF-8, formatação de datas, números e moedas pela API `Intl`, no idioma de cada pessoa.
- Dinheiro: inteiro na menor unidade da moeda (centavos), sempre com moeda ISO 4217. Nunca número com vírgula, nunca valor sem moeda, nunca soma entre moedas diferentes (ADR-012).
- País: códigos ISO 3166.
- Datas: guardadas em UTC no formato ISO 8601 com `Z`; convertidas para o fuso da empresa (nome IANA, como `America/Sao_Paulo`) só na tela.
- Site: um endereço por idioma, com `hreflang`.
- Acessibilidade das telas: WCAG 2.2 nível AA.
- Segurança das rotas: OWASP ASVS como lista de conferência.
- Web desde o início: nenhuma versão local ou mobile a migrar depois; regras de negócio em TypeScript puro, executadas no servidor da aplicação web.

## Consequências

Positivas: sem a limitação do mercado brasileiro. Negativas: custo de tradução, de suporte em inglês e de conformidade com leis de privacidade de cada lugar.

## Condições de revisão

Revisar antes do primeiro lançamento fora do Brasil.
