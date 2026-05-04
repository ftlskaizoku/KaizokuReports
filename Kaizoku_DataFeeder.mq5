//+------------------------------------------------------------------+
//|  Kaizoku_DataFeeder.mq5  v1.2                                    |
//|  Kaizoku Reports — D1 candle data feeder                        |
//+------------------------------------------------------------------+
#property copyright "Kaizoku Reports"
#property version   "1.2"
#property strict

input string   InpServerURL    = "https://kaizoku-reports.vercel.app";
input string   InpApiKey       = "";
input int      InpHistoryDays  = 1000;
input int      InpSyncInterval = 3600;
input bool     InpDebugMode    = false;
input string   InpSymbol1      = "UK100";
input string   InpSymbol2      = "DE30";
input string   InpSymbol3      = "XAUUSD";
input string   InpSymbol4      = "USOIL";

string   g_symbols[];
datetime g_lastSync    = 0;
bool     g_firstRun    = true;
string   g_endpoint;
datetime g_lastBarTime[]; // Track last D1 bar time per symbol

int OnInit()
{
   // Always reset on init (parameter change, attach, etc.)
   g_firstRun = true;
   g_lastSync = 0;

   ArrayResize(g_symbols, 4);
   g_symbols[0] = InpSymbol1;
   g_symbols[1] = InpSymbol2;
   g_symbols[2] = InpSymbol3;
   g_symbols[3] = InpSymbol4;

   ArrayResize(g_lastBarTime, 4);
   ArrayInitialize(g_lastBarTime, 0);

   g_endpoint = InpServerURL + "/api/ea/push";

   if(InpApiKey == "") {
      Print("ERROR: InpApiKey is empty! Get it from Admin Panel -> EA API Key -> Show/Hide");
      return INIT_PARAMETERS_INCORRECT;
   }

   Print("Kaizoku DataFeeder v1.2 — server: ", InpServerURL);
   PingServer();
   EventSetTimer(5);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer()
{
   datetime now = TimeCurrent();

   // First run: full history backfill
   if(g_firstRun) {
      g_firstRun = false;
      Print("Backfilling ", InpHistoryDays, " days of history...");
      for(int i = 0; i < ArraySize(g_symbols); i++) {
         SyncSymbol(g_symbols[i], InpHistoryDays);
         Sleep(600);
      }
      g_lastSync = now;
      Print("Backfill complete. Kaizoku is now receiving live D1 data.");
      EventSetTimer(InpSyncInterval);
      return;
   }

   // Periodic resync (every InpSyncInterval seconds)
   if(now - g_lastSync >= InpSyncInterval) {
      if(InpDebugMode) Print("Periodic sync...");
      for(int i = 0; i < ArraySize(g_symbols); i++) {
         SyncSymbol(g_symbols[i], 3);
         Sleep(300);
      }
      g_lastSync = now;
   }
}

//+------------------------------------------------------------------+
// Detect new D1 bar closing — push immediately when it closes
//+------------------------------------------------------------------+
void OnTick()
{
   if(g_firstRun) return; // Don't check ticks during backfill

   for(int i = 0; i < ArraySize(g_symbols); i++) {
      // iTime(symbol, D1, 0) = open time of current (incomplete) D1 bar
      // When a new bar opens, the previous bar has just closed
      datetime currentBarOpen = iTime(g_symbols[i], PERIOD_D1, 0);
      if(currentBarOpen == 0) continue;

      if(g_lastBarTime[i] == 0) {
         // First tick — just record the time, don't push yet
         g_lastBarTime[i] = currentBarOpen;
         continue;
      }

      if(currentBarOpen != g_lastBarTime[i]) {
         // New D1 bar just opened = previous D1 candle just CLOSED
         Print("New D1 candle closed for ", g_symbols[i], " — pushing immediately");
         SyncSymbol(g_symbols[i], 2); // Push last 2 closed candles
         g_lastBarTime[i] = currentBarOpen;
         g_lastSync = TimeCurrent(); // Reset periodic sync timer
      }
   }
}

//+------------------------------------------------------------------+
// Fetch N days of D1 candles and push to server
//+------------------------------------------------------------------+
void SyncSymbol(string symbol, int days)
{
   if(!SymbolSelect(symbol, true)) {
      Print("Symbol not found: ", symbol, " — check broker symbol name");
      return;
   }

   string json = "[";
   bool   first = true;
   int    count = 0;

   // i=1 means the last CLOSED bar (i=0 is current incomplete bar)
   for(int i = days; i >= 1; i--) {
      datetime bt = iTime(symbol, PERIOD_D1, i);
      if(bt == 0) continue;

      double o = iOpen(symbol,  PERIOD_D1, i);
      double h = iHigh(symbol,  PERIOD_D1, i);
      double l = iLow(symbol,   PERIOD_D1, i);
      double c = iClose(symbol, PERIOD_D1, i);
      long   v = iVolume(symbol, PERIOD_D1, i);

      if(o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;

      string d = TimeToString(bt, TIME_DATE);
      StringReplace(d, ".", "-");

      if(!first) json += ",";
      json += StringFormat(
         "{\"symbol\":\"%s\",\"date\":\"%s\",\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"volume\":%d}",
         symbol, d, o, h, l, c, v
      );
      first = false;
      count++;
   }
   json += "]";

   if(count == 0) { if(InpDebugMode) Print("No candles for ", symbol); return; }

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
   if(InpDebugMode) Print("Response(", res, "): ", StringSubstr(CharArrayToString(result), 0, 300));
   return res;
}

bool PingServer()
{
   char post[], result[];
   string rh;
   ArrayResize(post, 0);
   string h = "X-Api-Key: " + InpApiKey + "\r\n";
   int res = WebRequest("GET", InpServerURL + "/api/ea/status", h, 8000, post, result, rh);
   if(res == 200) { Print("Server OK: ", InpServerURL); return true; }
   Print("Server ping HTTP ", res, " — will retry on next sync.");
   return false;
}
