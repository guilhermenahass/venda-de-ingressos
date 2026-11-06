-- O preço do evento é meia-entrada, para todo mundo e sem prazo (decisão da
-- PEC). É do evento, não do código: outro espetáculo pode não ter.
alter table events add column if not exists meia_para_todos boolean not null default false;
