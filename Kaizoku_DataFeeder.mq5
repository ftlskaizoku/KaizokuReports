//+------------------------------------------------------------------+
//|  Kaizoku_DataFeeder.mq5                                          |
//|  Kaizoku Reports — D1 candle data feeder                        |
//+------------------------------------------------------------------+
#property copyright "Kaizoku Reports"
#property version   "1.1"
#property strict

input string   InpServerURL    = "https://kaizokureports.netlify.app";
input string   InpApiKey       = "";
input int      InpHistoryDays  = 1000;
input int      InpSyncInterval = 3600;
input bool     InpDebugMode    = false;
input string   InpSymbol1 = "UK100";
input string   InpSymbol2 = "DE30";
input string   InpSymbol3 = "XAUUSD";
input string   InpSymbol4 = "USOIL";

string   g_symbols[];
datetime g_lastSync = 0;
bool     g_firstRun = true;
string   g_endpoint;

int OnInit()
{
   // Reset state on every init (including parameter changes)
   g_firstRun = true;
   g_lastSync = 0;

   ArrayResize(g_symbols, 4);
   g_symbols[0] = InpSymbol1;
   g_symbols[1] = InpSymbol2;
   g_symbols[2] = InpSymbol3;
   g_symbols[3] = InpSymbol4;
   g_endpoint = InpServerURL + "/api/ea/push";

   if(InpApiKey == "") {
      Print("ERROR: InpApiKey is empty! Get it from Admin Panel -> EA API Key -> Show/Hide");
      return INIT_PARAMETERS_INCORRECT;
   }

   Print("Kaizoku DataFeeder v1.1 — server: ", InpServerURL);
   PingServer();
   EventSetTimer(5);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer()
{
   datetime now = TimeCurrent();
   if(g_firstRun) {
      g_firstRun = false;
      Print("Backfilling ", InpHistoryDays, " days of history...");
      for(int i = 0; i < ArraySize(g_symbols); i++) { SyncSymbol(g_symbols[i], InpHistoryDays); Sleep(500); }
      g_lastSync = now;
      Print("Backfill complete.");
      EventSetTimer(InpSyncInterval);
      return;
   }
   if(now - g_lastSync >= InpSyncInterval) {
      for(int i = 0; i < ArraySize(g_symbols); i++) { SyncSymbol(g_symbols[i], 3); Sleep(300); }
      g_lastSync = now;
   }
}

void OnTick()
{
   static datetime lastBar[];
   if(ArraySize(lastBar) != ArraySize(g_symbols)) { ArrayResize(lastBar, ArraySize(g_symbols)); ArrayInitialize(lastBar, 0); }
   for(int i = 0; i < ArraySize(g_symbols); i++) {
      datetime t = iTime(g_symbols[i], PERIOD_D1, 0);
      if(t == 0) continue;
      if(t != lastBar[i] && lastBar[i] != 0) SyncSymbol(g_symbols[i], 2);
      lastBar[i] = t;
   }
}

void SyncSymbol(string symbol, int days)
{
   if(!SymbolSelect(symbol, true)) { Print("Symbol not found: ", symbol); return; }

   string json = "[";
   bool   first = true;
   int    count = 0;

   for(int i = days - 1; i >= 1; i--) {
      datetime bt = iTime(symbol, PERIOD_D1, i);
      if(bt == 0) continue;
      double o = iOpen(symbol,PERIOD_D1,i), h = iHigh(symbol,PERIOD_D1,i);
      double l = iLow(symbol,PERIOD_D1,i),  c = iClose(symbol,PERIOD_D1,i);
      long   v = iVolume(symbol,PERIOD_D1,i);
      if(o<=0||h<=0||l<=0||c<=0) continue;

      // Format date YYYY-MM-DD using MQL5 built-in StringReplace (modifies in-place)
      string d = TimeToString(bt, TIME_DATE);
      StringReplace(d, ".", "-");

      if(!first) json += ",";
      json += StringFormat("{\"symbol\":\"%s\",\"date\":\"%s\",\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"volume\":%d}",
                           symbol, d, o, h, l, c, v);
      first = false;
      count++;
   }
   json += "]";

   if(count == 0) return;

   int res = PostJSON(g_endpoint, json);
   if(res == 200 || res == 207)
      Print("OK: ", symbol, " — ", count, " candles (HTTP ", res, ")");
   else
      Print("FAILED: ", symbol, " — HTTP ", res);
}

int PostJSON(string url, string body)
{
   char post[], result[];
   string rh;
   int len = StringLen(body);
   StringToCharArray(body, post, 0, len);
   ArrayResize(post, len);
   string h = "Content-Type: application/json\r\nX-Api-Key: " + InpApiKey + "\r\n";
   ResetLastError();
   int res = WebRequest("POST", url, h, 15000, post, result, rh);
   if(res == -1) {
      Print("WebRequest error ", GetLastError(), " — Add ", InpServerURL, " to Tools->Options->Expert Advisors->Allow WebRequest");
      return -1;
   }
   if(InpDebugMode) Print("Response(", res, "): ", StringSubstr(CharArrayToString(result), 0, 200));
   return res;
}

bool PingServer()
{
   char post[], result[]; string rh;
   ArrayResize(post, 0);
   int res = WebRequest("GET", InpServerURL + "/api/ea/status", "X-Api-Key: " + InpApiKey + "\r\n", 8000, post, result, rh);
   if(res == 200) { Print("Server OK: ", InpServerURL); return true; }
   Print("Server ping HTTP ", res, " — will retry.");
   return false;
}
