import {secp256k1} from '@noble/curves/secp256k1.js'
import {keccak_256} from '@noble/hashes/sha3.js'
import {bytesToHex, hexToBytes} from './fiscoV0Transaction.ts'
import type {Hex} from '@/shared/types'

export interface Web3TransactionData {
	nonce: bigint
	gasPrice: bigint
	gasLimit: bigint
	to: Hex | ''
	value: bigint
	data: Hex
	chainId: bigint
}

export interface SignedWeb3Transaction {
	rawTransaction: Hex
	transactionHash: Hex
}

export const signAndEncodeWeb3Transaction = (
	data: Web3TransactionData,
	privateKey: Hex,
): SignedWeb3Transaction => {
	assertTransactionData(data)
	const unsignedFields = [
		integerBytes(data.nonce),
		integerBytes(data.gasPrice),
		integerBytes(data.gasLimit),
		data.to ? hexToBytes(data.to) : new Uint8Array(),
		integerBytes(data.value),
		hexToBytes(data.data),
		integerBytes(data.chainId),
		new Uint8Array(),
		new Uint8Array(),
	]
	const digest = keccak_256(encodeRlpList(unsignedFields))
	const privateKeyBytes = hexToBytes(privateKey)
	try {
		const recoveredSignature = secp256k1.sign(digest, privateKeyBytes, {
			prehash: false,
			lowS: true,
			format: 'recovered',
		})
		if (recoveredSignature.length !== 65 || recoveredSignature[0] === undefined) {
			throw new Error('secp256k1 signer returned a malformed signature')
		}
		const recovery = BigInt(recoveredSignature[0])
		if (recovery !== 0n && recovery !== 1n) {
			throw new Error('secp256k1 signer returned an unsupported recovery id')
		}
		const signature = recoveredSignature.slice(1)
		const v = data.chainId * 2n + 35n + recovery
		const raw = encodeRlpList([
			...unsignedFields.slice(0, 6),
			integerBytes(v),
			trimLeadingZeroes(signature.slice(0, 32)),
			trimLeadingZeroes(signature.slice(32, 64)),
		])
		return {
			rawTransaction: `0x${bytesToHex(raw)}`,
			transactionHash: `0x${bytesToHex(keccak_256(raw))}`,
		}
	} finally {
		privateKeyBytes.fill(0)
	}
}

const assertTransactionData = (data: Web3TransactionData): void => {
	for (const [name, value] of [
		['nonce', data.nonce],
		['gasPrice', data.gasPrice],
		['gasLimit', data.gasLimit],
		['value', data.value],
		['chainId', data.chainId],
	] as const) {
		if (value < 0n) throw new Error(`Web3 transaction ${name} cannot be negative`)
	}
	if (data.chainId === 0n) throw new Error('Web3 transaction chainId must be positive')
	if (data.gasLimit === 0n) throw new Error('Web3 transaction gasLimit must be positive')
	if (data.to && !/^0x[0-9a-fA-F]{40}$/.test(data.to)) {
		throw new Error('Web3 transaction to must be a 20-byte address')
	}
	if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(data.data)) {
		throw new Error('Web3 transaction data must be even-length hexadecimal')
	}
}

const encodeRlpList = (values: readonly Uint8Array[]): Uint8Array => {
	const payload = concatBytes(...values.map(encodeRlpBytes))
	return concatBytes(encodeLength(payload.length, 0xc0), payload)
}

const encodeRlpBytes = (value: Uint8Array): Uint8Array => {
	if (value.length === 1 && value[0]! < 0x80) return value
	return concatBytes(encodeLength(value.length, 0x80), value)
}

const encodeLength = (length: number, offset: number): Uint8Array => {
	if (length < 56) return Uint8Array.of(offset + length)
	const lengthBytes = integerBytes(BigInt(length))
	return concatBytes(Uint8Array.of(offset + 55 + lengthBytes.length), lengthBytes)
}

const integerBytes = (value: bigint): Uint8Array => {
	if (value === 0n) return new Uint8Array()
	let hex = value.toString(16)
	if (hex.length % 2) hex = `0${hex}`
	return hexToBytes(hex)
}

const trimLeadingZeroes = (value: Uint8Array): Uint8Array => {
	let offset = 0
	while (offset < value.length && value[offset] === 0) offset += 1
	return value.slice(offset)
}

const concatBytes = (...values: readonly Uint8Array[]): Uint8Array => {
	const result = new Uint8Array(values.reduce((length, value) => length + value.length, 0))
	let offset = 0
	for (const value of values) {
		result.set(value, offset)
		offset += value.length
	}
	return result
}
