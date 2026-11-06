-- Cartão "em análise" no antifraude do Mercado Pago (in_process /
-- pending_review_manual): o dinheiro está reservado e a aprovação pode levar
-- de minutos a 2 dias. Enquanto isso o pedido segue pendente, os lugares
-- ficam guardados até em_analise_ate e a página diz "em análise", não
-- "expirou, nenhum valor foi cobrado" (que levava a mãe a comprar de novo).
alter table orders add column if not exists em_analise_ate timestamptz;
