import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import { cn } from '../lib/utils';
import { 
  LayoutDashboard, 
  Rocket, 
  Bot, 
  Zap, 
  Settings,
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { ScrollArea } from '../components/ui/scroll-area';

const NAV_ITEMS = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/runs', icon: Rocket, label: 'Runs' },
  { path: '/agents', icon: Bot, label: 'Agents' },
  { path: '/providers', icon: Zap, label: 'Providers' },
  { path: '/system', icon: Settings, label: 'System' },
];

export function MainLayout() {
  // WebSocket is connected globally in App.tsx - just read the state here
  const { wsConnected, sidebarCollapsed, toggleSidebar } = useAppStore();
  
  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside 
        className={cn(
          "relative flex flex-col border-r border-border bg-card/50 backdrop-blur-xl transition-all duration-300 ease-in-out",
          sidebarCollapsed ? "w-16" : "w-64"
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 text-white font-bold shadow-lg shadow-blue-500/25">
              A
            </div>
            {!sidebarCollapsed && (
              <span className="text-lg font-bold text-gradient animate-fade-in">
                AutoOrch
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
        
        {/* Navigation */}
        <ScrollArea className="flex-1 py-4">
          <nav className="space-y-1 px-2">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              return sidebarCollapsed ? (
                <Tooltip key={item.path} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <NavLink
                      to={item.path}
                      end={item.path === '/'}
                      className={({ isActive }) => cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg transition-all mx-auto",
                        isActive 
                          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" 
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </NavLink>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) => cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                    isActive 
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="animate-fade-in">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </ScrollArea>
        
        {/* Footer - Connection Status */}
        <div className="border-t border-border p-4">
          <div className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
            wsConnected ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
          )}>
            {wsConnected ? (
              <>
                <Wifi className="h-4 w-4" />
                <span className={cn("relative flex h-2 w-2", sidebarCollapsed && "mx-auto")}>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                </span>
                {!sidebarCollapsed && <span>Connected</span>}
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4" />
                {!sidebarCollapsed && <span>Disconnected</span>}
              </>
            )}
          </div>
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="container mx-auto max-w-7xl p-6">
            <Outlet />
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}
