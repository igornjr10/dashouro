//+------------------------------------------------------------------+
//| AurumPlano.mq5                                                   |
//| Desenha no gráfico de ouro o plano do painel Aurum: faixa da     |
//| Ásia, entrada, SL, TPs e camada de proteção. Não abre ordens.    |
//+------------------------------------------------------------------+
#property copyright "Aurum"
#property version   "1.00"
#property description "Lê o plano do painel Aurum (scalping da Ásia e CRT, com as suas regras de SL/TP) e desenha as linhas no gráfico. Só desenha: não envia, altera nem fecha ordens."

input string Url            = "https://dashouro-sigma.vercel.app/api/mt5"; // Endereço do plano (libere em Ferramentas → Opções → Expert Advisors)
input int    RefreshSeconds = 60;    // Atualizar a cada (segundos)
input bool   AlignToBroker  = true;  // Ajustar os preços à cotação da sua corretora
input bool   AlertOnNew     = true;  // Avisar quando aparecer uma entrada nova
input int    LineHours      = 6;     // Comprimento das linhas (horas depois da entrada)
input color  ColorEntry     = clrGold;
input color  ColorStop      = clrTomato;
input color  ColorTarget    = clrMediumSeaGreen;
input color  ColorLayer     = clrDarkOrange;
input color  ColorAsia      = C'40,48,72';

#define PREFIX "aurum_"

string seenIds   = "|";
bool   firstLoad = true;

// Chart times are broker server time; the plan is in UTC.
long ServerShift()
{
   long d = (long)(TimeTradeServer() - TimeGMT());
   return (long)MathRound(d / 1800.0) * 1800;
}

void Line(string name, datetime t1, datetime t2, double price, color c, ENUM_LINE_STYLE style, int width, string label)
{
   ObjectCreate(0, name, OBJ_TREND, 0, t1, price, t2, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_STYLE, style);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, width);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetString(0, name, OBJPROP_TOOLTIP, label);
   string tn = name + "_t";
   ObjectCreate(0, tn, OBJ_TEXT, 0, t2, price);
   ObjectSetString(0, tn, OBJPROP_TEXT, " " + label);
   ObjectSetInteger(0, tn, OBJPROP_COLOR, c);
   ObjectSetInteger(0, tn, OBJPROP_FONTSIZE, 8);
   ObjectSetInteger(0, tn, OBJPROP_ANCHOR, ANCHOR_LEFT);
   ObjectSetInteger(0, tn, OBJPROP_SELECTABLE, false);
}

void Box(string name, datetime t1, datetime t2, double p1, double p2, color c, string tip)
{
   ObjectCreate(0, name, OBJ_RECTANGLE, 0, t1, p1, t2, p2);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_FILL, true);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetString(0, name, OBJPROP_TOOLTIP, tip);
}

string Px(double p) { return DoubleToString(p, _Digits); }

void Fetch()
{
   char   body[], result[];
   string headers;
   ResetLastError();
   int code = WebRequest("GET", Url, "Accept: text/plain\r\n", 15000, body, result, headers);
   if(code == -1)
   {
      int err = GetLastError();
      Comment(err == 4014
              ? "Aurum · plano\nO MT5 bloqueou o acesso ao painel.\nVá em Ferramentas → Opções → Expert Advisors, marque \"Permitir WebRequest para as URLs listadas\"\ne adicione: https://dashouro-sigma.vercel.app"
              : "Aurum · plano\nSem conexão com o painel (erro " + IntegerToString(err) + "). Tento de novo em " + IntegerToString(RefreshSeconds) + " s.");
      return;
   }
   string text = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(code != 200)
   {
      Comment("Aurum · plano\nO painel respondeu HTTP " + IntegerToString(code) + ": " + StringSubstr(text, 0, 200));
      return;
   }

   string lines[];
   int n = StringSplit(text, '\n', lines);
   long   shift  = ServerShift();
   double offset = 0;
   string info   = "";
   bool   stale  = false;

   // First pass: the header line sets the price offset between the panel's feed and this broker.
   for(int i = 0; i < n; i++)
   {
      string f[];
      if(StringSplit(lines[i], '|', f) < 5 || f[0] != "AURUM")
         continue;
      long   closeTime = StringToInteger(f[2]);
      double refClose  = StringToDouble(f[3]);
      stale = f[4] == "1";
      if(AlignToBroker && closeTime > 0 && refClose > 0)
      {
         // The panel's last bar opened 5 minutes before closeTime; compare with the same M5 bar here.
         int idx = iBarShift(_Symbol, PERIOD_M5, (datetime)(closeTime - 300 + shift), true);
         if(idx >= 0)
            offset = iClose(_Symbol, PERIOD_M5, idx) - refClose;
      }
   }

   ObjectsDeleteAll(0, PREFIX);
   string fresh = "";
   for(int i = 0; i < n; i++)
   {
      string f[];
      int k = StringSplit(lines[i], '|', f);
      if(k < 1)
         continue;
      if(f[0] == "ASIA" && k >= 5)
      {
         datetime t1 = (datetime)(StringToInteger(f[1]) + shift), t2 = (datetime)(StringToInteger(f[2]) + shift);
         double hi = StringToDouble(f[3]) + offset, lo = StringToDouble(f[4]) + offset;
         Box(PREFIX + "asia", t1, t2, hi, lo, ColorAsia, "Faixa da Ásia " + Px(lo) + " – " + Px(hi));
         Line(PREFIX + "asia_hi", t1, t2, hi, clrSilver, STYLE_DOT, 1, "Máx. Ásia " + Px(hi));
         Line(PREFIX + "asia_lo", t1, t2, lo, clrSilver, STYLE_DOT, 1, "Mín. Ásia " + Px(lo));
      }
      else if(f[0] == "INFO" && k >= 4)
         info += f[1] + ": " + f[3] + "\n";
      else if(f[0] == "PLAN" && k >= 12)
      {
         string   id    = f[1], label = f[2];
         bool     buy   = f[3] == "buy";
         long     utc   = StringToInteger(f[4]);
         datetime t1    = (datetime)(utc + shift), t2 = (datetime)(utc + shift + LineHours * 3600);
         double   entry = StringToDouble(f[5]) + offset, sl = StringToDouble(f[6]) + offset;
         string   side  = buy ? "compra" : "venda";
         string   p     = PREFIX + id + "_";

         Line(p + "entry", t1, t2, entry, ColorEntry, STYLE_SOLID, 2, label + " · " + side + " " + Px(entry));
         Line(p + "sl", t1, t2, sl, ColorStop, STYLE_SOLID, 2, "SL " + Px(sl) + " (" + f[7] + " pips)");
         string tps[];
         int m = StringSplit(f[8], ',', tps);
         string tpText = "";
         for(int j = 0; j < m; j++)
         {
            string kv[];
            if(StringSplit(tps[j], ':', kv) < 2)
               continue;
            double tp = StringToDouble(kv[1]) + offset;
            Line(p + "tp" + IntegerToString(j), t1, t2, tp, ColorTarget, j == 0 ? STYLE_SOLID : STYLE_DASH, 1, kv[0] + " " + Px(tp));
            tpText += " · " + kv[0] + " " + Px(tp);
         }
         if(f[9] != "" && f[10] != "")
            Box(p + "layer", t1, t2, StringToDouble(f[9]) + offset, StringToDouble(f[10]) + offset, ColorLayer, "Camada de proteção (mesmo lote e mesmo SL)");
         ObjectCreate(0, p + "arrow", buy ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, t1, entry);
         ObjectSetInteger(0, p + "arrow", OBJPROP_SELECTABLE, false);

         string summary = label + ": " + side + " " + Px(entry) + " · SL " + Px(sl) + tpText;
         info += summary + "\n";
         if(StringFind(seenIds, "|" + id + "|") < 0)
         {
            seenIds += id + "|";
            // On start only entries from the last 30 minutes are announced; older ones are just drawn.
            if(AlertOnNew && (!firstLoad || TimeGMT() - utc < 1800))
               fresh += summary + "\n";
         }
      }
   }
   firstLoad = false;
   if(fresh != "")
      Alert("Aurum · nova entrada no plano\n" + fresh + "Confira no gráfico antes de operar.");

   Comment("Aurum · plano do painel (" + _Symbol + ")\n" + info +
           (AlignToBroker ? "Ajuste à sua corretora: " + DoubleToString(offset / 0.10, 1) + " pips\n" : "") +
           (stale ? "Atenção: dados do painel atrasados\n" : "") +
           "Atualizado " + TimeToString(TimeLocal(), TIME_MINUTES) + " · só desenha, não envia ordens");
   ChartRedraw();
}

int OnInit()
{
   if(RefreshSeconds < 15)
      return INIT_PARAMETERS_INCORRECT;
   EventSetTimer(RefreshSeconds);
   Fetch();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   ObjectsDeleteAll(0, PREFIX);
   Comment("");
}

void OnTimer() { Fetch(); }

void OnTick() {}
//+------------------------------------------------------------------+
