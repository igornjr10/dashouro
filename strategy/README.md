# Estratégia Aurum · XAU/USD (Python)

Backtest e níveis do dia para o ouro com os candles M5 da Twelve Data (a mesma chave do painel). Python 3.11+, sem bibliotecas extras.

```
python strategy/run.py              # baixa/atualiza 90 dias de M5, roda o backtest e gera strategy/output/relatorio.html
python strategy/run.py --offline    # usa o cache em strategy/data/, sem gastar requisições
python -m unittest discover -s strategy/tests
```

A chave vem de `TWELVEDATA_API_KEY` (variável de ambiente) ou do `.env.local` do painel. Cada requisição traz até 5000 candles (~17 dias de M5); o plano grátis permite 8 por minuto e 800 por dia, e o painel já usa ~400.

## O que é calculado

- **Perfil da sessão anterior** (dia UTC, como os candles diários da Exness): POC, área de valor de 70% (VAH/VAL), HVN e LVN, e em cada faixa de preço a parte de compradores e vendedores. O ouro spot não tem volume central e a Twelve Data não envia volume, então é um perfil por **tempo em cada preço (TPO)**; a divisão compra/venda vem da posição do fechamento de cada candle na sua faixa.
- **Níveis**: máxima/mínima/fechamento de ontem, Fibonacci da faixa de ontem (23,6 / 38,2 / 50 / 61,8 / 65 / 78,6 / 88,6%, com OTE entre 61,8 e 78,6%), máxima/mínima da Ásia (00–07 UTC) depois que a sessão fecha. Acima de 50% da faixa de ontem é premium (só venda), abaixo é discount (só compra).
- **CRT**: H4 no relógio de Nova York (abrindo 01, 05, 09, 13, 17, 21). Quando o H4 que abre às 01, 05 ou 09 NY varre a máxima ou a mínima do anterior e fecha de volta dentro, a entrada é no M5 durante o H4 seguinte, na primeira quebra de estrutura a favor (fechamento além dos 2 candles anteriores). Alvo: o outro lado do H4 anterior.
- **Rejeição de nível**: nas killzones (Londres 02–05 NY, Nova York 07–10 NY), um M5 fura um nível e fecha de volta, com pelo menos 2 pontos de confluência (níveis próximos, zona OTE, nó dominado pelo lado oposto).

## Regras do Igor aplicadas a toda entrada

1 pip = 0,10 USD. Stop 3 pips além da invalidação; se passar de 30 pips (Ásia/Londres) ou 50 (Nova York), a entrada é descartada em vez de apertar o stop. Mínimo de 10 pips. Saída em 3 partes: TP1 20, TP2 50 e TP3 80 pips (ou o alvo do setup, se mais perto); depois do TP1 o stop vai para a entrada. Se um candle toca o stop e um alvo, conta o stop. Operação aberta há mais de 24 h fecha no último preço.

## Resultado atual

**1 ano de M5 (30/10/2025 a 30/10/2026, 101.982 candles), com 3 pips de spread por operação:**

| Setup | Trades | Acerto (TP1+) | Pips sem spread | Pips com spread | Maior queda |
|---|---|---|---|---|---|
| CRT com entrada no M5 | 49 | 55% | −39 | −186 | 389 |
| Rejeição de nível | 1226 | 47% | +1460 | −2218 | 2686 |

Nenhum dos dois tem vantagem depois do spread. O resultado positivo dos primeiros 90 dias (CRT +122,6 pips em 14 trades) veio do único trimestre positivo do ano (T4: +127,6; T1 −164,6; T2 −49,9; T3 −99,1). Por sessão, o CRT em Londres teve 9 entradas e +205 pips e em Nova York 40 entradas e −391 pips: como essa separação foi vista depois do resultado, é uma hipótese para testar em conta demo, não uma regra. O spread de 3 pips é uma suposição; confira o real na Exness.

## Pesquisa de scalping (M1–M5)

`python strategy/scalp_run.py` testa quatro setups com as mesmas regras e 3 pips de spread (M5: 1 ano; M1: 30 dias, ~9 requisições para baixar).

| Setup | Trades | TP1+ | Pips com spread | 1ª / 2ª metade |
|---|---|---|---|---|
| Varredura da Ásia em Londres (M5) | 54 | 52% | +148,6 | +65,6 / +83,0 |
| CRT de M15 com entrada no M1 (30 dias) | 97 | 65% | +252,9 | +262,7 / −9,8 |
| Pullback na EMA20 (M5) | 457 | 46% | −74,8 | −321,4 / +246,6 |
| Pullback na EMA20 (M1, 30 dias) | 202 | 42% | −620,6 | −398,1 / −222,5 |
| Rompimento da abertura (M5 / M1) | 5 / 1 | — | quase sempre descartado: a faixa de 15 min passa do SL máximo | — |

A varredura da Ásia foi a única positiva nas duas metades do ano e em 3 de 4 trimestres (−24,5 / +90,1 / +56,2 / +6,5), mas a margem é pequena: +2,8 pips por operação com 3 pips de spread, e zera com spread perto de 6. Ganhou nas vendas (+182) e perdeu nas compras (−34). O CRT de M15 tem só 30 dias e caiu na segunda metade. Nada aqui está comprovado; o próximo passo é observar em conta demo.
