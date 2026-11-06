-- Um pedido vira 'conflict' por dois motivos diferentes: o assento foi para
-- outra pessoa antes do pagamento chegar, ou o valor pago nao bateu com o
-- total do pedido. Os dois estornam, mas a tela e o e-mail so tinham o texto
-- do primeiro -- quem caia no segundo lia uma explicacao falsa (e, no caso do
-- valor divergente, nao recebia e-mail nenhum: era estornado em silencio).
alter table orders
  add column if not exists conflict_reason text
    check (conflict_reason in ('assento', 'valor'));
