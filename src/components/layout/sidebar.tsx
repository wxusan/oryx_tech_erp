"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface SidebarItem {
  key: string
  label: string
  icon?: React.ReactNode
  badge?: string | number
}

interface NavItemProps {
  item: SidebarItem
  isActive: boolean
  onSelect: (key: string) => void
}

function NavItem({ item, isActive, onSelect }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.key)}
      data-active={isActive}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors",
        "rounded-[2px] text-left",
        isActive
          ? "bg-zinc-100 text-zinc-900 font-medium"
          : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 font-normal"
      )}
    >
      {item.icon && (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center [&_svg]:size-4",
            isActive ? "text-zinc-900" : "text-zinc-400"
          )}
        >
          {item.icon}
        </span>
      )}
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge !== undefined && (
        <span
          className={cn(
            "ml-auto text-xs tabular-nums",
            isActive ? "text-zinc-700" : "text-zinc-400"
          )}
        >
          {item.badge}
        </span>
      )}
    </button>
  )
}

interface SidebarProps {
  items: SidebarItem[]
  activeItem?: string
  onSelect: (key: string) => void
  className?: string
}

function Sidebar({ items, activeItem, onSelect, className }: SidebarProps) {
  return (
    <aside
      data-slot="sidebar"
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-zinc-200 bg-white",
        className
      )}
    >
      {/* Logo area */}
      <div className="flex h-12 shrink-0 items-center border-b border-zinc-200 px-4">
        <span className="text-sm font-bold tracking-tight text-zinc-900">
          Oryx ERP
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5" role="list">
          {items.map((item) => (
            <li key={item.key}>
              <NavItem
                item={item}
                isActive={activeItem === item.key}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

export { Sidebar, NavItem }
export type { SidebarProps, NavItemProps }
