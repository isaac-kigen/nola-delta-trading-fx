"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Laptop, Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const COLOR_STORAGE_KEY = "nola-primary-color";

const COLOR_PRESETS = [
  { name: "Emerald", hsl: "160 84% 39%" },
  { name: "Sky", hsl: "199 89% 48%" },
  { name: "Blue", hsl: "221 83% 53%" },
  { name: "Amber", hsl: "38 92% 50%" },
  { name: "Rose", hsl: "343 83% 59%" },
  { name: "Violet", hsl: "262 83% 58%" },
  { name: "Teal", hsl: "173 80% 40%" },
  { name: "Orange", hsl: "24 95% 53%" },
  { name: "Zinc", hsl: "240 5.9% 10%" },
];

const applyPrimaryColor = (hsl: string) => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.style.setProperty("--primary", hsl);
  root.style.setProperty("--ring", hsl);
};

const ThemeSwitcher = () => {
  const [mounted, setMounted] = useState(false);
  const [activeColor, setActiveColor] = useState(COLOR_PRESETS[0].hsl);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const savedColor = window.localStorage.getItem(COLOR_STORAGE_KEY);
    const defaultColor = savedColor || COLOR_PRESETS[0].hsl;
    setActiveColor(defaultColor);
    applyPrimaryColor(defaultColor);
    setMounted(true);
  }, []);

  const onColorChange = (hsl: string) => {
    setActiveColor(hsl);
    applyPrimaryColor(hsl);
    window.localStorage.setItem(COLOR_STORAGE_KEY, hsl);
  };

  if (!mounted) {
    return null;
  }

  const iconSize = 16;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full border-border/60 bg-card/90 shadow-xl backdrop-blur"
          aria-label="Open theme and color settings"
        >
          <Palette className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64 rounded-2xl p-3">
        <DropdownMenuLabel className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Appearance
        </DropdownMenuLabel>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Button
            variant={theme === "system" ? "default" : "outline"}
            size="sm"
            className="rounded-lg text-xs"
            onClick={() => setTheme("system")}
          >
            <Laptop size={iconSize} />
            Auto
          </Button>
          <Button
            variant={theme === "light" ? "default" : "outline"}
            size="sm"
            className="rounded-lg text-xs"
            onClick={() => setTheme("light")}
          >
            <Sun size={iconSize} />
            Light
          </Button>
          <Button
            variant={theme === "dark" ? "default" : "outline"}
            size="sm"
            className="rounded-lg text-xs"
            onClick={() => setTheme("dark")}
          >
            <Moon size={iconSize} />
            Dark
          </Button>
        </div>
        <DropdownMenuSeparator className="my-3" />
        <DropdownMenuLabel className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Primary Color
        </DropdownMenuLabel>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {COLOR_PRESETS.map((color) => (
            <button
              key={color.hsl}
              type="button"
              onClick={() => onColorChange(color.hsl)}
              title={color.name}
              className={cn(
                "h-9 rounded-xl border border-black/10 ring-offset-2 transition-transform hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeColor === color.hsl && "ring-2 ring-ring",
              )}
              style={{ backgroundColor: `hsl(${color.hsl})` }}
              aria-label={`Set primary color to ${color.name}`}
              aria-pressed={activeColor === color.hsl}
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export { ThemeSwitcher };
