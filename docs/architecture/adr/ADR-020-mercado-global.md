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

## Consequências

Positivas: sem a limitação do mercado brasileiro. Negativas: custo de tradução, de suporte em inglês e de conformidade com leis de privacidade de cada lugar.

## Condições de revisão

Revisar antes do primeiro lançamento fora do Brasil.
