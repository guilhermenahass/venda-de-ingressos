# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Mães e famílias de alunas da PEC Studio**, escola de dança de Sorocaba, comprando ingresso para o espetáculo de fim de ano em que a própria filha dança.

A situação que define tudo: a venda abre numa data e hora anunciadas, e cerca de 200 pessoas entram nos primeiros minutos, quase todas pelo celular, quase todas disputando as fileiras da frente. A cliente descreveu com as palavras dela: "muita mãe maluca entrando ao mesmo tempo querendo um lugar lá na frente". Não é público de teatro acostumado a mapa de assento — é mãe ansiosa, apressada, sob pressão de tempo, muitas vezes com a filha do lado.

O trabalho delas: escolher onde vão sentar para ver a filha, e pagar, sem perder o lugar para outra pessoa no meio do caminho.

**Equipe da PEC na portaria**, no dia do espetáculo: confere ingresso pelo celular, no escuro, com fila na porta.

## Product Purpose

Vender ingresso do espetáculo com mapa de lugares, recebendo o dinheiro **direto na conta da PEC**.

Existe porque as plataformas de bilheteria cobram taxa de conveniência alta (Sympla: 10% mais 2 a 2,5%, mínimo de R$3,99, repasse no terceiro dia útil). A PEC paga só a taxa do meio de pagamento (0,99% no Pix, 4,98% no cartão), repassada ao comprador, e recebe na hora.

Sucesso: a venda abre, as 200 pessoas entram ao mesmo tempo, ninguém compra um lugar que já é de outra pessoa, ninguém paga e fica sem ingresso, e no dia a fila da porta anda.

## Positioning

A bilheteria é da escola, não de uma plataforma. O dinheiro nunca passa por terceiro: cai na conta Mercado Pago da PEC no ato da compra. Nenhuma plataforma de bilheteria pode copiar isso, porque o modelo delas é justamente ficar no meio.

## Operating Context

- **Duas sessões**: 6 e 7 de novembro de 2026, ambas às 19:30, uma sessão por dia. Cada sessão é uma venda separada, com mapa próprio.
- **Uma página de entrada** escolhe a data e leva ao mapa daquela sessão. A PEC divulga um endereço só, no Instagram e no WhatsApp.
- **Compra**: a pessoa escolhe lugares no mapa, informa nome, e-mail e WhatsApp, e paga por Pix ou cartão no Mercado Pago. O lugar é reservado por 15 minutos a partir do "Pagar", não do clique no assento; a janela de pagamento no Mercado Pago é de 10 minutos.
- **Entrega**: e-mail com um QR por ingresso. A conferência na porta é pelo celular da equipe.
- **Lote**: a venda abre com tudo liberado de uma vez; passada uma data, o preço sobe. A cliente chama o primeiro lote de "meia".

## Capabilities and Constraints

**O teatro** (planta confirmada pela cliente, contada a partir da fota da planta):

- 19 fileiras: X, depois A até R. Cada fileira tem 24 cadeiras, numeradas de 1 a 24, com corredor central entre a 12 e a 13. **456 lugares.**
- **A plateia é uma arquibancada de 9 níveis.** Cada nível é uma dupla de fileiras: nível 1 são as fileiras A e B, nível 2 são C e D, e assim até o nível 9, que são Q e R. **Cada nível fica 20 cm acima do anterior.**
- A fileira X fica no chão, à frente da arquibancada, fora dos níveis.
- Em cada dupla, a fileira da frente custa mais que a de trás. Caras: X, A, C, E, G, I, K, M, O, Q (240 lugares). Baratas: B, D, F, H, J, L, N, P, R (216 lugares).
- **Não há lugar de cadeirante nesta planta.** Fato da cliente, não omissão.
- A PEC reserva alguns lugares para família e equipe. Quais, ainda não definido.

**Ainda indefinido, não inventar:** os valores dos ingressos e a data de virada do lote. O sistema roda hoje com valores provisórios.

**Técnico:** Next.js 16 App Router, React, Tailwind v4, TypeScript, Supabase Postgres, Mercado Pago Checkout Pro, Resend. A página do evento é cacheada por 60 s; o que é vivo (status dos assentos, relógio de abertura e de virada de lote) é resolvido no cliente a cada 5 s.

**Regra de dinheiro que nenhuma tela pode contradizer:** o preço vale o que o servidor calcula, nunca o que o cliente manda. O preço congela no momento do pedido.

## Brand Commitments

- **PEC Studio** — logo em `Identidade Visual/4897-logo_Pec_Studio.pdf`. "PEC" em cinza, "Studio" manuscrito em amarelo-esverdeado, assinatura "dança · música · arte".
- **PECkywest — O Mistério de Daisy Belle** é o espetáculo. Arte oficial em `Identidade Visual/PECkywest 14.pdf`: faroeste, papel envelhecido, tipografia vitoriana ornamentada em tinta preta, "EST. 1815", estrela de xerife. A cliente pediu explicitamente que o site inteiro siga essa pegada.
- A arte do espetáculo é a autoridade visual; a logo da PEC é a assinatura da casa, não o tema.

## Evidence on Hand

- Foto da planta do teatro: `Layout teatro.png` na raiz do projeto.
- Logo e arte do espetáculo: pasta `Identidade Visual/`.
- **Não existe**: foto do elenco, foto do teatro, texto de sinopse, depoimento, número de edições anteriores. Nada disso pode ser inventado em copy.

## Product Principles

1. **A abertura da venda é o momento de verdade.** Toda decisão se mede contra 200 pessoas entrando ao mesmo tempo, no celular, com pressa.
2. **O lugar é o produto.** A pessoa não compra "um ingresso", compra a chance de ver a filha de perto. O mapa precisa dizer o que ela está comprando — inclusive a altura.
3. **Nunca prometer o que o servidor não garantiu.** Nenhuma tela pode sugerir que um lugar é da pessoa antes de o servidor ter reservado.
4. **O dinheiro é da PEC e a conta tem que fechar.** Valor na tela, valor cobrado e valor recebido são o mesmo número, sempre.
5. **A porta tem que andar.** No dia, no escuro e com fila, funcionalidade vence tema.

## Accessibility & Inclusion

- Público majoritariamente em celular, muitos com o aparelho em modo escuro. Já houve um defeito real por isso: os campos do carrinho ficavam invisíveis.
- Cada assento é operável por teclado e anuncia setor, fileira, número, preço e situação.
- A planta não tem lugar de cadeirante. Se a PEC acomodar alguém, é combinado por fora do sistema.
