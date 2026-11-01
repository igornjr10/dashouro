# Aurum no MT5

## AurumSpread.mq5: medir o spread real

Robô (Expert Advisor) que só mede: mostra no gráfico o spread de agora e a média e o máximo por sessão, e grava um resumo por minuto. **Não abre ordens.** Serve para colocar o spread real da sua conta nos backtests (hoje eles supõem 3 pips).

1 pip = 0,10 USD. Sessões em UTC, iguais às do painel: Ásia 00–07, Londres 07–13, Nova York 13–21 (Brasília = UTC − 3).

### Instalar

1. No MT5: **Ferramentas → MetaQuotes Language Editor** (ou F4).
2. No MetaEditor: **Arquivo → Novo → Expert Advisor (modelo)**, nome `AurumSpread`, avance até concluir.
3. Apague todo o conteúdo do arquivo criado, cole o conteúdo de `AurumSpread.mq5` e clique em **Compilar** (F7). Deve terminar com "0 errors".
4. Volte ao MT5, abra um gráfico de **XAUUSD** (qualquer tempo gráfico) e arraste **AurumSpread** do Navegador (Expert Advisors) para o gráfico. Confirme com OK. Não precisa ligar o "Algo Trading", porque ele não opera.

### Usar

Deixe o gráfico aberto pelo menos durante Ásia, Londres e Nova York de um dia útil. O canto superior esquerdo mostra, por exemplo:

```
Aurum · spread de XAUUSD
Agora: 1.6 pips (0.16 USD) · custo total 1.6 pips
Comissão: 0.00 USD/lote ida+volta = 0.0 pips (média do seu histórico, 12.40 lotes)
Londres: média 1.7 · máx 3.2 pips · custo médio 1.7 pips
```

### Spread e comissão

- **Conta Standard / Standard Cent:** a margem da corretora já vem embutida no spread (bid/ask), então a comissão é 0 e o custo total é igual ao spread.
- **Conta Raw Spread / Zero / Pro:** o spread é pequeno, mas há uma comissão por lote cobrada fora do bid/ask. O robô lê essa comissão das suas próprias negociações de XAUUSD no histórico (só leitura: comissão + taxa ÷ lotes abertos) e soma ao spread em "custo total".
- Se não houver negociações de ouro no histórico, a comissão aparece como 0. Nesse caso, informe o valor em **CommissionPerLot** (aba Entradas, ao arrastar o robô): comissão de ida e volta por 1 lote, na moeda da conta. Exemplo: 7 USD por lote = 0,7 pip no ouro (1 pip em 1 lote = 10 USD).

O arquivo fica em **Arquivo → Abrir pasta de dados → MQL5 → Files → aurum_spread_XAUUSD.csv** (colunas separadas por `;`). Mande esse arquivo, ou um print das médias por sessão, para ajustar os testes.

## AurumPlano.mq5: o plano do painel no gráfico

Robô que **só desenha**: lê o plano do painel Aurum a cada minuto e marca no gráfico de ouro a faixa da Ásia e, quando há setup, a entrada (seta), o **SL**, os **TPs** e a faixa da **camada de proteção**. São os mesmos setups do painel (scalping da Ásia e CRT), já com as suas regras de stop e alvos. **Não envia, altera nem fecha ordens**: a decisão e a ordem são suas.

### Instalar

1. Libere o acesso ao painel: no MT5, **Ferramentas → Opções → Expert Advisors**, marque **"Permitir WebRequest para as URLs listadas"**, clique em adicionar e digite `https://dashouro-sigma.vercel.app`. OK.
2. No MetaEditor (F4): **Arquivo → Novo → Expert Advisor (modelo)**, nome `AurumPlano`, cole o conteúdo de `AurumPlano.mq5` e compile (F7).
3. O MT5 aceita um robô por gráfico. Abra **outro** gráfico de XAUUSD (M5 ou M15 é o melhor) e arraste **AurumPlano** para ele. O AurumSpread fica no primeiro.

### Como ler

- **Retângulo cinza:** faixa da Ásia (00–07 UTC), com a máxima e a mínima pontilhadas.
- **Linha dourada e seta:** entrada (compra ou venda).
- **Linha vermelha:** SL, com os pips.
- **Linhas verdes:** TP1 (cheia), TP2 e TP3 (tracejadas).
- **Faixa laranja:** onde entraria a camada de proteção (mesmo lote e mesmo SL).
- O canto do gráfico mostra o status do scalping e do CRT e o ajuste de preço aplicado.

O painel usa a cotação da Twelve Data, que difere um pouco da Exness. Com **AlignToBroker** ligado, o robô compara o último candle M5 dos dois e desloca as linhas para o seu preço; os pips de SL e TP não mudam.

Quando surge uma entrada nova, aparece um alerta do MT5 (desligue em **AlertOnNew**). Os mesmos avisos chegam no Telegram.
