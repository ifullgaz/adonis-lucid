import fs from 'node:fs'
import { hostname } from 'node:os'
import dns from 'node:dns/promises'
import { errors } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import type { BaseModel } from '@adonisjs/lucid/orm'
import type { ModelAttributes } from '@adonisjs/lucid/types/model'
import type { HttpContext } from '@adonisjs/core/http'
import type { LucidModel } from '@adonisjs/lucid/types/model'

// Constrain T to be an object with string keys and any values
export function extractParam<T extends Record<string, any>>(params: T, field: string): any {
  let param = params[field] ?? []
  if (typeof param === 'string') {
    try {
      param = JSON.parse(param)
    } catch (e) {
      if (e instanceof Error) {
        logger.error('Error parsing param:', e.message)
      } else {
        logger.error('Unknown error:', e)
      }
      throw errors.E_HTTP_EXCEPTION.invoke({ errors: ['Invalid format'] }, 422)
    }
  }

  return param
}

export function randomNumericCode(digits: number) {
  return Math.floor(Math.random() * Math.pow(10, digits))
    .toString()
    .padStart(digits, '0')
}

export function filterColumns<T extends typeof BaseModel>(
  modelClass: T,
  data: Partial<ModelAttributes<InstanceType<T>>>
) {
  const columnsDefinitions = modelClass.$columnsDefinitions
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => columnsDefinitions.has(key))
  ) as Partial<ModelAttributes<InstanceType<T>>>
}

export function sleep(delay: number) {
  return new Promise((resolve) => setTimeout(resolve, delay))
}

export function isJSON(value: any): boolean {
  return (
    Array.isArray(value) ||
    value.constructor === Object ||
    (typeof value.toJSON === 'function' && !Buffer.isBuffer(value))
  )
}

export async function getCallerIp(ctx: HttpContext): Promise<string> {
  const ip =
    ctx.request.header('x-forwarded-for') ||
    ctx.request.ip() ||
    (await getHostPrivateAddress()) ||
    (await getLocalHostAddress())

  return ip
}

async function getHostPrivateAddress(): Promise<string | null> {
  const metadataFile = process.env['ECS_CONTAINER_METADATA_FILE']
  if (metadataFile && fs.existsSync(metadataFile)) {
    try {
      const raw = fs.readFileSync(metadataFile, 'utf-8')
      const metadata = JSON.parse(raw)
      return metadata?.HostPrivateIPv4Address || null
    } catch (err) {}
  }
  return null
}

async function getLocalHostAddress(): Promise<string> {
  try {
    const res = await dns.lookup(hostname())
    return res.address
  } catch {
    return '127.0.0.1'
  }
}

export function truncate(num: number, decimals: number = 2) {
  const factor = 10 ** decimals
  return Math.trunc(num * factor) / factor
}

export function formatSecondsToDuration(seconds: number): string {
  const s = Math.floor(seconds)

  const units = [
    { secs: 31536000, label: 'year' }, // 365 * 24 * 3600
    { secs: 2592000, label: 'month' }, // 30  * 24 * 3600
    { secs: 86400, label: 'day' }, // 24  * 3600
    { secs: 3600, label: 'hour' }, // 3600
    { secs: 60, label: 'minute' }, // 60
    { secs: 1, label: 'second' }, // 1
  ]

  for (const { secs, label } of units) {
    if (s >= secs) {
      const val = Math.floor(s / secs)
      return `${val} ${label}${val !== 1 ? 's' : ''}`
    }
  }

  // fallback (should never hit, because last unit is 1s)
  return '0 seconds'
}

type TimestampKeys = 'createdAt' | 'updatedAt' | 'created_at' | 'updated_at'

export function modelFields<T extends LucidModel>(
  model: T,
  options?: { exclude?: string[]; excludeTimestamps?: boolean }
): Array<Exclude<keyof InstanceType<T>, TimestampKeys> & string> {
  const columns = [...model.$columnsDefinitions.keys()]

  const exclude = new Set<string>(options?.exclude ?? [])

  if (options?.excludeTimestamps !== false) {
    const createdAt = (model as any).createdAtColumn as string | undefined
    const updatedAt = (model as any).updatedAtColumn as string | undefined
    if (createdAt) exclude.add(createdAt)
    if (updatedAt) exclude.add(updatedAt)
  }

  return columns.filter((c) => !exclude.has(c)) as any
}

export function pickModelFields<T extends LucidModel>(
  model: T,
  payload: Record<string, unknown>,
  opts?: { exclude?: string[]; excludeTimestamps?: boolean }
) {
  const allowed = new Set<string>(modelFields(model, opts))
  return Object.fromEntries(Object.entries(payload).filter(([k]) => allowed.has(k)))
}

/**
 * Resolves a model attribute name (`createdAt`) or column name (`created_at`)
 * to the column name. Returns null when the field is not a model column.
 */
export function modelColumnName(model: LucidModel, field: string): string | null {
  const column =
    model.$getColumn(field) ??
    [...model.$columnsDefinitions.values()].find((definition) => definition.columnName === field)
  return column?.columnName ?? null
}

export function qualifiedColumnName(model: LucidModel, field: string): string {
  const column = modelColumnName(model, field)
  return column ? `${model.table}.${column}` : field
}

export type Task<T> = () => Promise<T>

export async function promiseAllWithLimit<T>(
  tasks: Task<T>[],
  limit: number
): Promise<(T | Error)[]> {
  const results: (T | Error)[] = new Array(tasks.length)
  let i = 0
  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = i++
      if (currentIndex >= tasks.length) {
        break
      }
      try {
        results[currentIndex] = await tasks[currentIndex]()
      } catch (err) {
        results[currentIndex] = err instanceof Error ? err : new Error(String(err))
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  await Promise.all(workers)

  return results
}

export const defer = (fn: () => Promise<void>, msg: string, delay: number = 0) => {
  const run =
    delay > 0 ? new Promise<void>((resolve) => setTimeout(resolve, delay)) : Promise.resolve()
  run.then(fn).catch((error) => {
    logger.error(error, msg)
  })
}
