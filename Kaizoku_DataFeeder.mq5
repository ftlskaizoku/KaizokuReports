//+------------------------------------------------------------------+
//|  Kaizoku_DataFeeder.mq5                                          |
//|  Kaizoku Reports — D1 candle data feeder                         |
//|                                                                  |
//|  Collects Daily (D1) OHLCV candles for the four symbols and      |
//|  pushes them to the Kaizoku Reports server via REST API.         |
//|                                                                  |
//|  Symbols: UK100, DE30 (GER30/GER40), XAUUSD, USOIL              |
//|  Timeframe: D1 only                                              |
//+------------------------------------------------------------------+
#property copyright "Kaizoku Reports"
#property version   "1.0"
#property strict

#include <JAson.mqh>   // Include MQL5 JSON library if available, otherwise we build strings manually

//--- Input parameters
input string   InpServerURL    = "https://your-app.railway.app";  // Server URL (no trailing slash)
input string   InpApiKey       = "your-ea-api-key-here";           // EA API Key (set in Railway Variables)
input int      InpHistoryDays  = 1000;                             // Days of history to backfill on first run
input int      InpSyncInterval = 3600;                             // Resync interval in seconds (default 1hr)
input bool     InpDebugMode    = false;                            // Print debug info to Experts log

//--- Symbols to track (broker names may differ — edit to match your broker exactly)
input string   InpSymbol1 = "UK100";     // Symbol 1
input string   InpSymbol2 = "DE30";      // Symbol 2  (try GER30, GER40, DAX40 if DE30 fails)
input string   InpSymbol3 = "XAUUSD";   // Symbol 3
input string   InpSymbol4 = "USOIL";    // Symbol 4  (try WTI, OIL, USOIL+ if USOIL fails)

//--- Globals
string   g_symbols[];
datetime g_lastSync   = 0;
bool     g_firstRun   = true;
string   g_endpoint;

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
{
   //--- Build symbol list from inputs
   ArrayResize(g_symbols, 4);
   g_symbols[0] = InpSymbol1;
   g_symbols[1] = InpSymbol2;
   g_symbols[2] = InpSymbol3;
   g_symbols[3] = InpSymbol4;

   g_endpoint = InpServerURL + "/api/ea/push";

   Print("Kaizoku DataFeeder v1.0 — initialized");
   Print("Server: ", InpServerURL);
   Print("Symbols: ", InpSymbol1, ", ", InpSymbol2, ", ", InpSymbol3, ", ", InpSymbol4);

   //--- Test connection on init
   if (!PingServer()) {
      Print("WARNING: Cannot reach server at ", InpServerURL, " — will retry on each tick.");
   }

   //--- First run: push full history
   EventSetTimer(5);  // Trigger first sync after 5 seconds
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("Kaizoku DataFeeder stopped. Reason: ", reason);
}

//+------------------------------------------------------------------+
//| Timer event — main sync logic                                    |
//+------------------------------------------------------------------+
void OnTimer()
{
   datetime now = TimeCurrent();

   //--- First run: push full history backfill
   if (g_firstRun) {
      g_firstRun = false;
      Print("Starting history backfill (", InpHistoryDays, " days)...");
      for (int i = 0; i < ArraySize(g_symbols); i++) {
         SyncSymbol(g_symbols[i], InpHistoryDays);
         Sleep(500); // Brief pause between symbols
      }
      g_lastSync = now;
      Print("History backfill complete.");
      EventSetTimer(InpSyncInterval);
      return;
   }

   //--- Regular sync: only push today's (and yesterday's) candle
   if (now - g_lastSync >= InpSyncInterval) {
      for (int i = 0; i < ArraySize(g_symbols); i++) {
         SyncSymbol(g_symbols[i], 3); // Last 3 days covers any gaps
         Sleep(300);
      }
      g_lastSync = now;
      if (InpDebugMode) Print("Regular sync complete at ", TimeToString(now));
   }
}

//+------------------------------------------------------------------+
//| On new D1 bar — push the just-closed daily candle immediately    |
//+------------------------------------------------------------------+
void OnTick()
{
   static datetime lastBarTime[];
   if (ArraySize(lastBarTime) != ArraySize(g_symbols)) {
      ArrayResize(lastBarTime, ArraySize(g_symbols));
      ArrayInitialize(lastBarTime, 0);
   }

   for (int i = 0; i < ArraySize(g_symbols); i++) {
      datetime barTime = iTime(g_symbols[i], PERIOD_D1, 0);
      if (barTime == 0) continue;

      if (barTime != lastBarTime[i] && lastBarTime[i] != 0) {
         // New D1 bar just opened — previous bar is now closed
         if (InpDebugMode) Print("New D1 bar detected for ", g_symbols[i], " — pushing closed candle.");
         SyncSymbol(g_symbols[i], 2);
      }
      lastBarTime[i] = barTime;
   }
}

//+------------------------------------------------------------------+
//| Sync a symbol: fetch N days of D1 candles and push to server     |
//+------------------------------------------------------------------+
void SyncSymbol(string symbol, int days)
{
   if (!SymbolSelect(symbol, true)) {
      Print("Symbol not available: ", symbol, " — check broker symbol name.");
      return;
   }

   //--- Build JSON array of candles
   string json = "[";
   bool   first = true;
   int    pushed = 0;

   for (int i = days - 1; i >= 1; i--) {  // i=1 means yesterday (last closed bar)
      datetime barTime = iTime(symbol, PERIOD_D1, i);
      if (barTime == 0) continue;

      double o = iOpen(symbol,  PERIOD_D1, i);
      double h = iHigh(symbol,  PERIOD_D1, i);
      double l = iLow(symbol,   PERIOD_D1, i);
      double c = iClose(symbol, PERIOD_D1, i);
      long   v = iVolume(symbol, PERIOD_D1, i);

      if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue; // Skip invalid bars

      string dateStr = TimeToString(barTime, TIME_DATE); // "YYYY.MM.DD" → need to reformat
      dateStr = StringReplace(dateStr, ".", "-");         // → "YYYY-MM-DD"

      if (!first) json += ",";
      json += "{";
      json += "\"symbol\":\"" + symbol + "\",";
      json += "\"date\":\"" + dateStr + "\",";
      json += "\"open\":"  + DoubleToString(o, 5) + ",";
      json += "\"high\":"  + DoubleToString(h, 5) + ",";
      json += "\"low\":"   + DoubleToString(l, 5) + ",";
      json += "\"close\":" + DoubleToString(c, 5) + ",";
      json += "\"volume\":" + IntegerToString(v);
      json += "}";
      first = false;
      pushed++;
   }
   json += "]";

   if (pushed == 0) {
      if (InpDebugMode) Print("No candles to push for ", symbol);
      return;
   }

   //--- Send to server
   int result = PostJSON(g_endpoint, json);
   if (result == 200 || result == 207) {
      if (InpDebugMode) Print("Pushed ", pushed, " candles for ", symbol, " — HTTP ", result);
   } else {
      Print("Push failed for ", symbol, " — HTTP ", result);
   }
}

//+------------------------------------------------------------------+
//| HTTP POST helper — sends JSON to the endpoint                    |
//+------------------------------------------------------------------+
int PostJSON(string url, string jsonBody)
{
   char   post[];
   char   result[];
   string resultHeaders;

   //--- Convert string to char array
   StringToCharArray(jsonBody, post, 0, StringLen(jsonBody));
   ArrayResize(post, StringLen(jsonBody)); // Remove null terminator

   //--- Set headers
   string headers = "Content-Type: application/json\r\n";
   headers += "X-Api-Key: " + InpApiKey + "\r\n";

   ResetLastError();
   int timeout = 10000; // 10 seconds
   int res = WebRequest("POST", url, headers, timeout, post, result, resultHeaders);

   if (res == -1) {
      int err = GetLastError();
      Print("WebRequest error: ", err, " — Make sure the URL is whitelisted in MT5 Tools → Options → Expert Advisors");
      return -1;
   }

   if (InpDebugMode) {
      string body = CharArrayToString(result);
      Print("Server response (", res, "): ", StringSubstr(body, 0, 200));
   }

   return res;
}

//+------------------------------------------------------------------+
//| Test connection to server                                        |
//+------------------------------------------------------------------+
bool PingServer()
{
   char   post[], result[];
   string headers = "X-Api-Key: " + InpApiKey + "\r\n";
   string resultHeaders;
   string statusUrl = InpServerURL + "/api/ea/status";

   ArrayResize(post, 0);
   int res = WebRequest("GET", statusUrl, headers, 5000, post, result, resultHeaders);

   if (res == 200) {
      Print("Server connection OK — ", InpServerURL);
      return true;
   }
   Print("Server unreachable (HTTP ", res, ") — ", InpServerURL);
   return false;
}

//+------------------------------------------------------------------+
//| Utility: replace substring                                       |
//+------------------------------------------------------------------+
string StringReplace(string src, string find, string replace)
{
   string result = src;
   int pos = StringFind(result, find);
   while (pos >= 0) {
      result = StringSubstr(result, 0, pos) + replace + StringSubstr(result, pos + StringLen(find));
      pos = StringFind(result, find, pos + StringLen(replace));
   }
   return result;
}
//+------------------------------------------------------------------+
