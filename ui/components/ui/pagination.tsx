'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Pagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number
  totalPages: number
  totalItems: number
  onPageChange: (page: number) => void
}) {
  const safePage = Math.min(page, totalPages)

  function getVisiblePages(): (number | 'ellipsis')[] {
    const delta = 1
    const range: number[] = []

    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= safePage - delta && i <= safePage + delta)
      ) {
        range.push(i)
      }
    }

    const result: (number | 'ellipsis')[] = []
    let prev = 0
    for (const p of range) {
      if (p - prev > 1) {
        result.push('ellipsis')
      }
      result.push(p)
      prev = p
    }

    return result
  }

  const visiblePages = getVisiblePages()

  return (
    <div className="flex items-center justify-between" role="navigation" aria-label="Pagination">
      <p className="text-xs text-muted-foreground">
        Page {safePage} of {totalPages} ({totalItems} total)
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
        </Button>
        {visiblePages.map((n, i) =>
          n === 'ellipsis' ? (
            <span key={`ellipsis-${i}`} className="grid size-8 place-items-center text-xs text-muted-foreground">
              ...
            </span>
          ) : (
            <Button
              key={n}
              variant={n === safePage ? 'default' : 'outline'}
              size="icon"
              onClick={() => onPageChange(n)}
              aria-label={`Page ${n}`}
              aria-current={n === safePage ? 'page' : undefined}
            >
              {n}
            </Button>
          ),
        )}
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
          disabled={safePage >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight size={15} />
        </Button>
      </div>
    </div>
  )
}
