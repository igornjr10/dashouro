//+------------------------------------------------------------------+
//| AurumSpread.mq5                                                  |
//| Mede o spread real do símbolo do gráfico (pips de 0,10 USD) e    |
//| grava um resumo por minuto em MQL5/Files. Não abre ordens.       |
//+------------------------------------------------------------------+
#property copyright "Aurum"
#property version   "1.10"
#property description "Mede o spread em pips (1 pip = 0,10 USD) a cada tick, soma a comissão da conta, mostra a média e o máximo por sessão e grava MQL5/Files/aurum_spread_<simbolo>.csv. Não envia ordens."

input double PipSize          = 0.10;   // Tamanho do pip em preço (ouro: 0,10 USD)
input double CommissionPerLot = -1;     // Comissão ida+volta por lote, na moeda da conta (-1 = ler do seu histórico)

// Commission per round trip, in pips; on Standard accounts the broker's markup is already inside the spread and this is 0.
double   commPips = 0;
string   commNote = "";

// Sessions in UTC, same hours as the dashboard: Asia 00-07, London 07-13, New York 13-21, rest 21-24.
string   SessionName[4] = {"Ásia", "Londres", "Nova York", "Fora"};
double   sessSum[4], sessMax[4];
long     sessCnt[4];

int      fileHandle = INVALID_HANDLE;
datetime minuteKey  = 0;
double   minMin, minMax, minSum;
long     minCnt     = 0;

int SessionOf(datetime utc)
{
   MqlDateTime t;
   TimeToStruct(utc, t);
   if(t.hour < 7)  return 0;
   if(t.hour < 13) return 1;
   if(t.hour < 21) return 2;
   return 3;
}

void WriteMinute()
{
   if(minCnt == 0 || fileHandle == INVALID_HANDLE)
      return;
   FileWrite(fileHandle, TimeToString(minuteKey, TIME_DATE | TIME_MINUTES), _Symbol, SessionName[SessionOf(minuteKey)],
             DoubleToString(minMin, 1), DoubleToString(minSum / (double)minCnt, 2), DoubleToString(minMax, 1), (string)minCnt);
   FileFlush(fileHandle);
}

// Raw Spread / Zero / Pro accounts charge a commission per lot outside the bid/ask. Either the input value or the
// average of the account's own closed deals on this symbol (commission + fee over the lots opened), read-only.
void LoadCommission()
{
   double perLot = CommissionPerLot;
   string from   = "informada";
   if(perLot < 0)
   {
      perLot = 0;
      from   = "sem negociações de " + _Symbol + " no histórico";
      if(HistorySelect(0, TimeCurrent()))
      {
         double comm = 0, lots = 0;
         int n = HistoryDealsTotal();
         for(int i = 0; i < n; i++)
         {
            ulong d = HistoryDealGetTicket(i);
            if(d == 0 || HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol)
               continue;
            comm += HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_FEE);
            if(HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN)
               lots += HistoryDealGetDouble(d, DEAL_VOLUME);
         }
         if(lots > 0)
         {
            perLot = -comm / lots;
            from   = "média do seu histórico, " + DoubleToString(lots, 2) + " lotes";
         }
      }
   }
   // One pip on one lot = PipSize × contract size (100 oz on gold: 0,10 × 100 = 10 USD).
   double pipValue = PipSize * SymbolInfoDouble(_Symbol, SYMBOL_TRADE_CONTRACT_SIZE);
   commPips = pipValue > 0 ? perLot / pipValue : 0;
   string ccy = AccountInfoString(ACCOUNT_CURRENCY);
   commNote = StringFormat("Comissão: %.2f %s/lote ida+volta = %.1f pips (%s)", perLot, ccy, commPips, from);
   if(ccy != SymbolInfoString(_Symbol, SYMBOL_CURRENCY_PROFIT))
      commNote += "\nAtenção: conta em " + ccy + "; a conversão da comissão em pips supõe a mesma moeda do lucro do símbolo";
   Print("AurumSpread: ", commNote);
}

int OnInit()
{
   if(PipSize <= 0)
      return INIT_PARAMETERS_INCORRECT;
   LoadCommission();
   ArrayInitialize(sessSum, 0);
   ArrayInitialize(sessMax, 0);
   ArrayInitialize(sessCnt, 0);
   string name = "aurum_spread_" + _Symbol + ".csv";
   fileHandle = FileOpen(name, FILE_READ | FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_SHARE_READ, ';');
   if(fileHandle == INVALID_HANDLE)
   {
      Print("AurumSpread: não foi possível abrir ", name, " (erro ", GetLastError(), ")");
      return INIT_FAILED;
   }
   if(FileSize(fileHandle) == 0)
      FileWrite(fileHandle, "minuto_utc", "simbolo", "sessao", "spread_min_pips", "spread_medio_pips", "spread_max_pips", "ticks");
   FileSeek(fileHandle, 0, SEEK_END);
   Print("AurumSpread: gravando em MQL5/Files/", name);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   WriteMinute();
   if(fileHandle != INVALID_HANDLE)
      FileClose(fileHandle);
   Comment("");
}

void OnTick()
{
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick) || tick.bid <= 0 || tick.ask <= 0)
      return;
   double spread = (tick.ask - tick.bid) / PipSize;
   datetime utc = TimeGMT();
   datetime key = utc - utc % 60;

   // Minute summary: written when the minute changes.
   if(key != minuteKey)
   {
      WriteMinute();
      minuteKey = key;
      minMin = spread; minMax = spread; minSum = 0; minCnt = 0;
   }
   minMin = MathMin(minMin, spread);
   minMax = MathMax(minMax, spread);
   minSum += spread;
   minCnt++;

   int s = SessionOf(utc);
   sessSum[s] += spread;
   sessCnt[s]++;
   sessMax[s] = MathMax(sessMax[s], spread);

   string text = StringFormat("Aurum · spread de %s\nAgora: %.1f pips (%.2f USD) · custo total %.1f pips\n%s\n", _Symbol, spread, tick.ask - tick.bid, spread + commPips, commNote);
   for(int i = 0; i < 4; i++)
      if(sessCnt[i] > 0)
         text += StringFormat("%s: média %.1f · máx %.1f pips · custo médio %.1f pips (%d ticks)\n", SessionName[i], sessSum[i] / (double)sessCnt[i], sessMax[i], sessSum[i] / (double)sessCnt[i] + commPips, (int)sessCnt[i]);
   text += "1 pip = " + DoubleToString(PipSize, 2) + " USD · sessões em UTC · não envia ordens";
   Comment(text);
}
//+------------------------------------------------------------------+
