# Aurum CRT na TradingView

`aurum_crt.pine` (Pine Script v6) desenha no gráfico o mesmo CRT do painel e do backtest em Python: H4 no relógio de Nova York, varredura no H4 das 01h, 05h ou 09h NY, entrada no M5 na quebra dos 2 candles anteriores, SL de até 30 pips (Ásia/Londres) ou 50 (Nova York), TP 20/50/80 ou o alvo do CRT, camada de 10–20 pips.

## Instalar

1. Abra um gráfico de **XAUUSD** na TradingView no **M5**.
2. Embaixo, clique em **Editor Pine**, apague o que estiver lá e cole todo o conteúdo de `aurum_crt.pine`.
3. Clique em **Salvar** (dê um nome, por exemplo "Aurum CRT") e depois em **Adicionar ao gráfico**.

## Alertas

Em **Alerta** → Condição: **Aurum CRT** → **Qualquer chamada de função alert()**. A mensagem já vem com entrada, SL e TPs. As opções "CRT: varredura confirmada" e "CRT: entrada no M5" também existem, com texto fixo.

## Diferenças

A entrada é marcada no fechamento do candle que quebrou a estrutura (no painel e no backtest, é a abertura do candle seguinte; a diferença costuma ser de centavos). O preço é o do feed escolhido na TradingView (OANDA, FX etc.) e pode diferir alguns pips da Exness.
