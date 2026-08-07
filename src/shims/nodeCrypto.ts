export const getRandomValues = (array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
	if (!globalThis.crypto?.getRandomValues) {
		throw new Error('Secure browser randomness is unavailable')
	}
	return globalThis.crypto.getRandomValues(array)
}

export const randomBytes = (size: number): Uint8Array => {
	if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid random byte length')
	return getRandomValues(new Uint8Array(size))
}

export default {getRandomValues, randomBytes}
