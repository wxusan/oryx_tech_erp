"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export interface ColumnDef<TData> {
  key: string
  label: string
  sortable?: boolean
  className?: string
  headerClassName?: string
  render?: (value: TData[keyof TData], row: TData, index: number) => React.ReactNode
}

type SortDirection = "asc" | "desc"

interface SortState {
  key: string
  direction: SortDirection
}

interface DataTableProps<TData extends Record<string, unknown>> {
  columns: ColumnDef<TData>[]
  data: TData[]
  className?: string
  emptyMessage?: string
}

function SortIcon({
  direction,
  active,
}: {
  direction?: SortDirection
  active: boolean
}) {
  return (
    <span
      className={cn(
        "ml-1.5 inline-flex flex-col items-center justify-center gap-px",
        active ? "text-zinc-900" : "text-zinc-300"
      )}
      aria-hidden
    >
      <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
        <path
          d="M4 0L7.46410 5H0.535898L4 0Z"
          fill={active && direction === "asc" ? "currentColor" : "#d4d4d8"}
        />
      </svg>
      <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
        <path
          d="M4 5L0.535898 0H7.46410L4 5Z"
          fill={active && direction === "desc" ? "currentColor" : "#d4d4d8"}
        />
      </svg>
    </span>
  )
}

function DataTable<TData extends Record<string, unknown>>({
  columns,
  data,
  className,
  emptyMessage = "Ma'lumot topilmadi",
}: DataTableProps<TData>) {
  const [sort, setSort] = React.useState<SortState | null>(null)

  function handleSort(key: string) {
    setSort((prev) => {
      if (prev?.key === key) {
        if (prev.direction === "asc") return { key, direction: "desc" }
        return null
      }
      return { key, direction: "asc" }
    })
  }

  const sortedData = React.useMemo(() => {
    if (!sort) return data

    return [...data].sort((a, b) => {
      const aVal = a[sort.key]
      const bVal = b[sort.key]

      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1

      const comparison =
        typeof aVal === "string" && typeof bVal === "string"
          ? aVal.localeCompare(bVal, "uz")
          : typeof aVal === "number" && typeof bVal === "number"
            ? aVal - bVal
            : String(aVal).localeCompare(String(bVal))

      return sort.direction === "asc" ? comparison : -comparison
    })
  }, [data, sort])

  return (
    <div
      data-slot="data-table"
      className={cn("w-full overflow-hidden border border-zinc-200", className)}
    >
      <Table>
        <TableHeader>
          <TableRow className="border-b border-zinc-200 hover:bg-transparent">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  "h-9 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500",
                  col.sortable &&
                    "cursor-pointer select-none hover:text-zinc-700",
                  col.headerClassName
                )}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
                aria-sort={
                  sort?.key === col.key
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : col.sortable
                      ? "none"
                      : undefined
                }
              >
                <span className="inline-flex items-center">
                  {col.label}
                  {col.sortable && (
                    <SortIcon
                      active={sort?.key === col.key}
                      direction={sort?.key === col.key ? sort.direction : undefined}
                    />
                  )}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {sortedData.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 px-3 text-center text-sm text-zinc-400"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            sortedData.map((row, rowIndex) => (
              <TableRow
                key={rowIndex}
                className="border-b border-zinc-100 transition-colors hover:bg-zinc-50/50"
              >
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={cn("px-3 py-2.5 text-sm text-zinc-700", col.className)}
                  >
                    {col.render
                      ? col.render(
                          row[col.key] as TData[keyof TData],
                          row,
                          rowIndex
                        )
                      : (row[col.key] as React.ReactNode) ?? "—"}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export { DataTable }
export type { DataTableProps, SortState, SortDirection }
