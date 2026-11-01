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
Agora: 1.6 pips (0.16 USD)
Londres: média 1.7 · máx 3.2 pips
```

O arquivo fica em **Arquivo → Abrir pasta de dados → MQL5 → Files → aurum_spread_XAUUSD.csv** (colunas separadas por `;`). Mande esse arquivo, ou um print das médias por sessão, para ajustar os testes.
