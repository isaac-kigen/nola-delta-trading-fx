import Link from "next/link";
import { Activity, ArrowUpRight, BarChart3, BellDot, CandlestickChart, Globe, ShieldCheck, Sparkles, Target, TrendingUp, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  const marketPairs = [
    { pair: "BTC/USDT", price: "$68,420.20", move: "+3.2%", positive: true },
    { pair: "ETH/USDT", price: "$3,542.84", move: "+2.1%", positive: true },
    { pair: "SOL/USDT", price: "$181.06", move: "-1.4%", positive: false },
    { pair: "EUR/USD", price: "1.0892", move: "+0.5%", positive: true },
  ];
  const tickerTape = [
    "sync-latest-candle OK",
    "check-trading-opportunity RUN",
    "execute-broker-orders LIVE",
    "sync-broker-positions 5m",
    "ctrader-callback READY",
    "finnhub 1m pipeline",
  ];
  const positions = [
    { symbol: "BTCUSDT", side: "Long", entry: "66,950", pnl: "+$820", positive: true },
    { symbol: "XAUUSD", side: "Long", entry: "2,338", pnl: "+$210", positive: true },
    { symbol: "SOLUSDT", side: "Short", entry: "185.2", pnl: "-$96", positive: false },
  ];

  const features = [
    {
      icon: CandlestickChart,
      title: "Signal Lifecycle Engine",
      description: "Opportunity checks, signal states, and cycle-aware trigger control.",
    },
    {
      icon: ShieldCheck,
      title: "Risk Governance",
      description: "Runtime config and per-symbol limits enforce disciplined exposure.",
    },
    {
      icon: BellDot,
      title: "Ops + Alert Monitoring",
      description: "Function runs and alert streams keep the desk operationally safe.",
    },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,hsl(var(--primary)/0.16),transparent_48%),radial-gradient(circle_at_85%_8%,hsl(var(--chart-2)/0.15),transparent_42%)]" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col px-4 pb-14 pt-4 sm:px-6 lg:px-8">
        <nav className="glass-panel sticky top-4 z-20 mb-8 flex items-center justify-between rounded-2xl px-4 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <TrendingUp className="size-4" />
            </div>
            <span className="text-sm font-semibold tracking-wide sm:text-base">Nola Trade</span>
          </div>
          <div className="hidden items-center gap-4 text-sm text-muted-foreground sm:flex">
            <Link className="hover:text-foreground" href="#markets">Markets</Link>
            <Link className="hover:text-foreground" href="#strategies">Strategies</Link>
            <Link className="hover:text-foreground" href="#insights">Insights</Link>
          </div>
          <Button size="sm" className="rounded-xl">
            Open App
            <ArrowUpRight />
          </Button>
        </nav>
        <section className="ticker-shell mb-6 overflow-hidden rounded-xl border border-border/60 py-2">
          <div className="ticker-track flex min-w-max items-center gap-8 px-4 text-xs font-medium">
            {tickerTape.concat(tickerTape).map((item, index) => (
              <span key={`${item}-${index}`} className="text-muted-foreground">
                {item}
              </span>
            ))}
          </div>
        </section>

        <section className="grid items-center gap-4 pb-8 pt-4 sm:gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4 sm:space-y-5">
            <Badge className="rounded-full px-3 py-1 text-xs">
              Built for nola.co.ke traders
            </Badge>
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
              Trade with clarity.
              <span className="block text-primary">Move with confidence.</span>
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
              A modern execution dashboard designed for fast decisions, mobile flow, and disciplined risk.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button className="rounded-xl">
                <Wallet />
                Start Trading
              </Button>
              <Button variant="outline" className="rounded-xl">
                <Globe />
                Live Market Feed
              </Button>
            </div>
          </div>
          <Card className="glass-panel rounded-3xl border-white/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <BarChart3 className="size-4 text-primary" />
                Portfolio Momentum
              </CardTitle>
              <CardDescription>Today performance overview</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Account Equity</p>
                  <p className="text-2xl font-semibold sm:text-3xl">$41,280</p>
                </div>
                <Badge className="rounded-full bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                  +8.4%
                </Badge>
              </div>
              <div className="h-24 rounded-2xl bg-[linear-gradient(120deg,hsl(var(--primary)/0.35),hsl(var(--chart-2)/0.3),transparent)]" />
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-xl bg-muted/50 p-2">
                  <p className="text-muted-foreground">Win Rate</p>
                  <p className="font-semibold">71%</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-2">
                  <p className="text-muted-foreground">Avg RR</p>
                  <p className="font-semibold">1:2.6</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-2">
                  <p className="text-muted-foreground">Open Trades</p>
                  <p className="font-semibold">4</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="markets" className="grid gap-4 pb-10 lg:grid-cols-[1.25fr_0.75fr]">
          <Card className="glass-panel rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="size-4 text-primary" />
                Market Watchlist
              </CardTitle>
              <CardDescription>Live symbols and daily movement</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {marketPairs.map((item) => (
                <div key={item.pair} className="grid grid-cols-3 items-center rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-sm">
                  <p className="font-medium">{item.pair}</p>
                  <p className="text-center text-muted-foreground">{item.price}</p>
                  <p className={item.positive ? "text-right font-medium text-emerald-500" : "text-right font-medium text-rose-500"}>
                    {item.move}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="size-4 text-primary" />
                Quick Execution
              </CardTitle>
              <CardDescription>Preset risk and one-tap entry</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border border-border/70 p-3">
                <p className="text-xs text-muted-foreground">Selected Symbol</p>
                <p className="font-semibold">EUR/USD (Photon v3.1)</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button asChild className="rounded-xl"><Link href="/protected/execution">Execution Queue</Link></Button>
                <Button asChild variant="outline" className="rounded-xl"><Link href="/protected/signals">Signal Board</Link></Button>
              </div>
              <div className="rounded-xl bg-muted/70 p-3">
                <p className="text-xs text-muted-foreground">Policy Snapshot</p>
                <p className="font-semibold">One trade per cycle: enabled</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 pb-10 lg:grid-cols-[1fr_1fr]">
          <Card className="rounded-2xl border-border/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Open Positions</CardTitle>
              <CardDescription>Mirrors `trading_positions` behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {positions.map((position) => (
                <div key={position.symbol} className="grid grid-cols-4 items-center rounded-xl border border-border/60 px-3 py-2">
                  <p className="font-medium">{position.symbol}</p>
                  <p className="text-muted-foreground">{position.side}</p>
                  <p className="text-muted-foreground">{position.entry}</p>
                  <p className={position.positive ? "text-right font-medium text-emerald-500" : "text-right font-medium text-rose-500"}>
                    {position.pnl}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Strategy Pulse</CardTitle>
              <CardDescription>Runtime + execution health focus</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3">
                <span className="text-muted-foreground">Photon structure engine</span>
                <Badge className="rounded-full bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">Stable</Badge>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3">
                <span className="text-muted-foreground">Broker error rate (30m)</span>
                <span className="font-semibold">1.8%</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3">
                <span className="text-muted-foreground">API quota pressure</span>
                <span className="font-semibold">Low</span>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="strategies" className="grid gap-4 pb-10 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="rounded-2xl border-border/70">
              <CardHeader className="space-y-3">
                <div className="w-fit rounded-xl bg-primary/10 p-2 text-primary">
                  <feature.icon className="size-4" />
                </div>
                <CardTitle className="text-base">{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </section>

        <section id="insights" className="relative overflow-hidden rounded-3xl border border-border/60 bg-card p-5 sm:p-8">
          <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative grid items-center gap-4 lg:grid-cols-[1fr_auto]">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                <Sparkles className="size-3.5" />
                Production Pipeline
              </p>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">End-to-end flow from market data to broker fill.</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
                Nola Trade runs synced candles, opportunity checks, signal lifecycle management, broker intent execution, callback reconciliation, and ops monitoring in one desk.
              </p>
            </div>
            <Button asChild className="rounded-xl">
              <Link href="/protected">
              Open Protected Dashboard
              <ArrowUpRight />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
