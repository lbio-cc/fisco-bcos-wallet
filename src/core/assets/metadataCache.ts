import type {NftMetadata} from '../../shared/assetMessages'

export const METADATA_BUDGET_BYTES = 4 * 1024 * 1024
export const METADATA_RECORD_LIMIT_BYTES = 32 * 1024
const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength

export const fitMetadataBudget = (
	records: Record<string, NftMetadata>,
	budget = METADATA_BUDGET_BYTES,
): { records: Record<string, NftMetadata>; bytes: number; omitted: number } => {
	const candidates = Object.entries(records)
		.filter(([, record]) => bytes(record) <= METADATA_RECORD_LIMIT_BYTES)
		.sort((a, b) => b[1].lastAccessedAt - a[1].lastAccessedAt || a[0].localeCompare(b[0]))
	const kept: Record<string, NftMetadata> = {}
	let used = 2
	for (const [key, record] of candidates) {
		const size = bytes({[key]: record}) - 2
		if (used + size > budget) continue
		kept[key] = record
		used += size
	}
	return {records: kept, bytes: bytes(kept), omitted: Object.keys(records).length - Object.keys(kept).length}
}

export const replaceMetadataAfterCompletePass = (
	previous: Record<string, NftMetadata>,
	next: Record<string, NftMetadata>,
	complete: boolean,
): Record<string, NftMetadata> => (complete ? next : previous)
