import {secp256k1} from '@noble/curves/secp256k1.js'
import {keccak_256} from '@noble/hashes/sha3.js'
import smCrypto from 'sm-crypto'
import type {CryptoKind, Hex} from '@/shared/types'

export interface FiscoV0TransactionData {
	version: 0
	chainID: string
	groupID: string
	blockLimit: bigint
	nonce: string
	to: string
	input: Uint8Array
	abi: string
}

export interface FiscoTransactionSigningAccount {
	crypto: CryptoKind
	privateKey: Hex
	publicKey: Hex
}

export interface SignedFiscoTransaction {
	rawTransaction: Hex
	transactionHash: Hex
}

const textEncoder = new TextEncoder()
const FISCO_SM2_USER_ID = '1234567812345678'
const FISCO_EVM_ABI_CODEC_ATTRIBUTE = 1
const FISCO_NONCE_MIN = 10n ** 39n
const FISCO_NONCE_RANGE = 9n * FISCO_NONCE_MIN

export const createFiscoNonce = (): string => {
	if (!globalThis.crypto?.getRandomValues) {
		throw new Error('Secure random number generation is unavailable')
	}
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(20))
	try {
		let randomValue = 0n
		for (const byte of bytes) randomValue = (randomValue << 8n) | BigInt(byte)
		return (FISCO_NONCE_MIN + (randomValue % FISCO_NONCE_RANGE)).toString()
	} finally {
		bytes.fill(0)
	}
}

export const encodeFiscoV0TransactionData = (
	data: FiscoV0TransactionData,
): Uint8Array => {
	assertV0Data(data)
	const writer = new TarsWriter()
	writer.writeInt32(data.version, 1)
	writer.writeString(data.chainID, 2)
	writer.writeString(data.groupID, 3)
	writer.writeInt64(data.blockLimit, 4)
	writer.writeString(data.nonce, 5)
	writer.writeString(data.to, 6)
	writer.writeBytes(data.input, 7)
	if (data.abi) writer.writeString(data.abi, 8)
	return writer.toBytes()
}

export const serializeFiscoV0HashFields = (
	data: FiscoV0TransactionData,
): Uint8Array => {
	assertV0Data(data)
	return concatBytes(
		signedIntegerBytes(BigInt(data.version), 4),
		textEncoder.encode(data.chainID),
		textEncoder.encode(data.groupID),
		signedIntegerBytes(data.blockLimit, 8),
		textEncoder.encode(data.nonce),
		textEncoder.encode(data.to),
		data.input,
		textEncoder.encode(data.abi),
	)
}

export const signAndEncodeFiscoV0Transaction = (
	data: FiscoV0TransactionData,
	account: FiscoTransactionSigningAccount,
): SignedFiscoTransaction => {
	// FISCO BCOS 3.2 nodes hash the TransactionData fields in protocol order,
	// using fixed-width big-endian integers and raw string/input bytes.
	const hashFields = serializeFiscoV0HashFields(data)
	const dataHash =
		account.crypto === 'gm'
			? hexToBytes(smCrypto.sm3(Array.from(hashFields)))
			: keccak_256(hashFields)
	const privateKey = hexToBytes(account.privateKey)
	const publicKey = normalizePublicKey(account.publicKey)

	try {
		const signature =
			account.crypto === 'gm'
				? signSm2Hash(dataHash, privateKey, publicKey)
				: signSecp256k1Hash(dataHash, privateKey)
		const rawTransaction = encodeFiscoTransaction(data, dataHash, signature)
		return {
			rawTransaction: `0x${bytesToHex(rawTransaction)}`,
			transactionHash: `0x${bytesToHex(dataHash)}`,
		}
	} finally {
		privateKey.fill(0)
	}
}

const encodeFiscoTransaction = (
	data: FiscoV0TransactionData,
	dataHash: Uint8Array,
	signature: Uint8Array,
): Uint8Array => {
	const writer = new TarsWriter()
	writer.writeStruct(encodeFiscoV0TransactionData(data), 1)
	writer.writeBytes(dataHash, 2)
	writer.writeBytes(signature, 3)
	writer.writeInt32(FISCO_EVM_ABI_CODEC_ATTRIBUTE, 5)
	return writer.toBytes()
}

const signSm2Hash = (
	hash: Uint8Array,
	privateKey: Uint8Array,
	publicKey: Uint8Array,
): Uint8Array => {
	if (publicKey.length !== 64) throw new Error('SM2 public key must be 64 bytes')
	const privateKeyHex = bytesToHex(privateKey)
	const derivedPublicKey = normalizePublicKey(
		`0x${smCrypto.sm2.getPublicKeyFromPrivateKey(privateKeyHex)}`,
	)
	if (bytesToHex(derivedPublicKey) !== bytesToHex(publicKey)) {
		throw new Error('SM2 public key does not match the signing private key')
	}
	const signatureHex = smCrypto.sm2.doSignature(
		Array.from(hash),
		privateKeyHex,
		{
			// FISCO 3.2 uses sm2_do_sign(..., EVP_sm3(), userId, dataHash).
			// Therefore SM2 must calculate SM3(ZA || dataHash), not sign the
			// dataHash integer directly.
			hash: true,
			der: false,
			publicKey: `04${bytesToHex(derivedPublicKey)}`,
			userId: FISCO_SM2_USER_ID,
		},
	)
	const signature = hexToBytes(signatureHex)
	if (signature.length !== 64) throw new Error('SM2 signer returned a malformed signature')
	const publicKeyHex = bytesToHex(derivedPublicKey)
	if (
		!smCrypto.sm2.doVerifySignature(
			Array.from(hash),
			signatureHex,
			`04${publicKeyHex}`,
			{
				hash: true,
				der: false,
				userId: FISCO_SM2_USER_ID,
			},
		)
	) {
		throw new Error('Local SM2 transaction signature verification failed')
	}
	return concatBytes(signature, derivedPublicKey)
}

const signSecp256k1Hash = (
	hash: Uint8Array,
	privateKey: Uint8Array,
): Uint8Array => {
	const recoveredSignature = secp256k1.sign(hash, privateKey, {
		prehash: false,
		lowS: true,
		format: 'recovered',
	})
	if (recoveredSignature.length !== 65 || recoveredSignature[0] === undefined) {
		throw new Error('secp256k1 signer returned a malformed signature')
	}
	return concatBytes(recoveredSignature.slice(1), Uint8Array.of(recoveredSignature[0]))
}

const normalizePublicKey = (value: Hex): Uint8Array => {
	const bytes = hexToBytes(value)
	if (bytes.length === 65 && bytes[0] === 4) return bytes.slice(1)
	return bytes
}

const assertV0Data = (data: FiscoV0TransactionData): void => {
	if (data.version !== 0) throw new Error('Only FISCO BCOS V0 transactions are supported')
	if (!data.chainID || !data.groupID) throw new Error('FISCO chainID and groupID are required')
	if (data.blockLimit < 0n || data.blockLimit > 0x7fffffffffffffffn) {
		throw new Error('FISCO blockLimit is outside the signed 64-bit range')
	}
	if (!/^[1-9][0-9]*$/.test(data.nonce)) {
		throw new Error('FISCO nonce must be a decimal string without leading zeroes')
	}
}

class TarsWriter {
	private readonly chunks: Uint8Array[] = []

	writeInt32(value: number, tag: number): void {
		if (!Number.isSafeInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
			throw new Error('Tars int32 value is out of range')
		}
		this.writeInteger(BigInt(value), tag, TarsType.Int)
	}

	writeInt64(value: bigint, tag: number): void {
		if (value < -0x8000000000000000n || value > 0x7fffffffffffffffn) {
			throw new Error('Tars int64 value is out of range')
		}
		this.writeInteger(value, tag, TarsType.Long)
	}

	writeString(value: string, tag: number): void {
		const bytes = textEncoder.encode(value)
		if (bytes.length <= 0xff) {
			this.writeHead(TarsType.String1, tag)
			this.push(Uint8Array.of(bytes.length), bytes)
			return
		}
		this.writeHead(TarsType.String4, tag)
		this.push(unsignedIntegerBytes(BigInt(bytes.length), 4), bytes)
	}

	writeBytes(value: Uint8Array, tag: number): void {
		this.writeHead(TarsType.SimpleList, tag)
		this.writeHead(TarsType.Byte, 0)
		this.writeInteger(BigInt(value.length), 0, TarsType.Int)
		this.push(value)
	}

	writeStruct(value: Uint8Array, tag: number): void {
		this.writeHead(TarsType.StructBegin, tag)
		this.push(value)
		this.writeHead(TarsType.StructEnd, 0)
	}

	toBytes(): Uint8Array {
		return concatBytes(...this.chunks)
	}

	private writeInteger(value: bigint, tag: number, maximumType: TarsType): void {
		if (value === 0n) {
			this.writeHead(TarsType.ZeroTag, tag)
		} else if (value >= -0x80n && value <= 0x7fn) {
			this.writeHead(TarsType.Byte, tag)
			this.push(signedIntegerBytes(value, 1))
		} else if (value >= -0x8000n && value <= 0x7fffn) {
			this.writeHead(TarsType.Short, tag)
			this.push(signedIntegerBytes(value, 2))
		} else if (
			maximumType >= TarsType.Int &&
			value >= -0x80000000n &&
			value <= 0x7fffffffn
		) {
			this.writeHead(TarsType.Int, tag)
			this.push(signedIntegerBytes(value, 4))
		} else {
			this.writeHead(TarsType.Long, tag)
			this.push(signedIntegerBytes(value, 8))
		}
	}

	private writeHead(type: TarsType, tag: number): void {
		if (!Number.isSafeInteger(tag) || tag < 0 || tag > 0xff) {
			throw new Error('Tars tag is out of range')
		}
		if (tag < 15) this.push(Uint8Array.of((tag << 4) | type))
		else this.push(Uint8Array.of(0xf0 | type, tag))
	}

	private push(...values: Uint8Array[]): void {
		this.chunks.push(...values)
	}
}

enum TarsType {
	Byte = 0,
	Short = 1,
	Int = 2,
	Long = 3,
	String1 = 6,
	String4 = 7,
	StructBegin = 10,
	StructEnd = 11,
	ZeroTag = 12,
	SimpleList = 13,
}

const signedIntegerBytes = (value: bigint, length: number): Uint8Array => {
	const bits = BigInt(length * 8)
	const normalized = value < 0 ? (1n << bits) + value : value
	return unsignedIntegerBytes(normalized, length)
}

const unsignedIntegerBytes = (value: bigint, length: number): Uint8Array => {
	const result = new Uint8Array(length)
	let remaining = value
	for (let index = length - 1; index >= 0; index--) {
		result[index] = Number(remaining & 0xffn)
		remaining >>= 8n
	}
	if (remaining !== 0n) throw new Error('Integer does not fit in the requested byte length')
	return result
}

const concatBytes = (...values: Uint8Array[]): Uint8Array => {
	const result = new Uint8Array(values.reduce((length, value) => length + value.length, 0))
	let offset = 0
	for (const value of values) {
		result.set(value, offset)
		offset += value.length
	}
	return result
}

export const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

export const hexToBytes = (value: string): Uint8Array => {
	const normalized = value.startsWith('0x') ? value.slice(2) : value
	if (!/^(?:[0-9a-f]{2})*$/i.test(normalized)) throw new Error('Invalid hexadecimal value')
	return Uint8Array.from(
		normalized.match(/.{2}/g) ?? [],
		(byte) => Number.parseInt(byte, 16),
	)
}
