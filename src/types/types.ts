type IncludeField =
  | string
  | {
      n: string // 'name'
      f?: string | string[] // 'id,name...' with no spaces, or ['id', 'name']
      r?: Include | IncludeField // Recursive relations
    }
type Include = IncludeField[] // e.g., ['owner', 'posts']
type IncludeParams = {
  include?: Include
}
// [field, operator, value] or { or: [...] } or { and: [...] }
type FieldFilter = [string, string, any]
type OrFilter = { or: Filter[] }
type AndFilter = { and: Filter[] }
type Filter = FieldFilter | OrFilter | AndFilter
type FilterParams = {
  filters?: Filter[]
}

type Sort = Record<string, 'asc' | 'desc'> // e.g., { name: 'asc', createdAt: 'desc' }
type SortParams = {
  sort?: Sort
}

type Group = string
type GroupParams = { group?: Group[] }

type WithCount = string
type WithCountParams = { withCount?: WithCount[] }

type PaginationParams = { page?: number; perPage?: number }

type PojoParams = { pojo?: boolean }

type FreeParams = {
  [key: string]: any
}

type QueryParams = IncludeParams &
  FilterParams &
  SortParams &
  GroupParams &
  WithCountParams &
  PaginationParams &
  PojoParams &
  FreeParams

export type { Include, IncludeField, IncludeParams }
export type { Filter, FieldFilter, FilterParams }
export type { Sort, SortParams }
export type { Group, GroupParams }
export type { WithCount, WithCountParams }
export type { PaginationParams }
export type { PojoParams }
export type { FreeParams }
export type { QueryParams }

// turns "otherId" -> "other_id", "createdAt" -> "created_at"
type SnakeCase<S extends string> = S extends `${infer H}${infer T}`
  ? T extends Uncapitalize<T>
    ? `${Lowercase<H>}${SnakeCase<T>}`
    : `${Lowercase<H>}_${SnakeCase<T>}`
  : S

export type SnakeCased<T extends Record<string, any>> = {
  [K in keyof T as K extends string ? SnakeCase<K> : never]: T[K]
}
