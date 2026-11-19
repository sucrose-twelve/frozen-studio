/**
 * One page of a list. Page numbers start at 1; `nextPage` / `prevPage` are `null` at either end, and
 * `lastPage` is at least 1 so an empty list still has one (empty) page.
 */
declare type Pagination<T = unknown> = {
  data: T[]
  count: number
  take: number
  currentPage: number
  nextPage: number | null
  prevPage: number | null
  lastPage: number
}

declare type NextParams<T = Record<string, string>> = Readonly<{
  params: Promise<T>
}>

declare type NextSearchParams<T = Record<string, string | string[] | undefined>> =
  Readonly<{
    searchParams: Promise<T>
  }>
