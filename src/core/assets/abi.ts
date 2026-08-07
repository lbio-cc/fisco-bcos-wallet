import {keccak_256} from '@noble/hashes/sha3.js'
import smCrypto from 'sm-crypto'
import type {CryptoKind, Hex} from '../../shared/types'

const encoder = new TextEncoder()
const word = (hex: string): string => hex.padStart(64, '0')

export const normalizeContractAddress = (value: string): Hex => {
	const normalized = value.trim().toLowerCase()
	if (!/^0x[0-9a-f]{40}$/.test(normalized)) throw new Error('请输入 20 字节 0x 合约地址')
	if (/^0x0{40}$/.test(normalized)) throw new Error('零地址不是有效的资产合约')
	return normalized as Hex
}

export const normalizeAssetRecipient = (value: string): Hex => {
	const normalized = value.trim().toLowerCase()
	if (!/^0x[0-9a-f]{40}$/.test(normalized)) throw new Error('请输入 20 字节 0x 目标地址')
	if (/^0x0{40}$/.test(normalized)) throw new Error('不能发送到零地址')
	return normalized as Hex
}

export const parseTokenAmount = (value: string, decimals: number): bigint => {
	const normalized = value.trim()
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
		throw new Error('代币精度无效')
	}
	if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) throw new Error('请输入有效的发送数量')
	const [whole = '0', fraction = ''] = normalized.split('.')
	if (fraction.length > decimals) throw new Error(`该代币最多支持 ${decimals} 位小数`)
	const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')
	if (raw <= 0n) throw new Error('发送数量必须大于 0')
	return raw
}

export const functionSelector = (signature: string, crypto: CryptoKind): string => {
	const digest =
		crypto === 'gm'
			? smCrypto.sm3(Array.from(encoder.encode(signature)))
			: Array.from(keccak_256(encoder.encode(signature)))
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join('')
	return digest.slice(0, 8)
}

export const erc165InterfaceId = (signatures: readonly string[], crypto: CryptoKind): Hex => {
	if (!signatures.length) throw new Error('ERC165 接口必须包含至少一个函数签名')
	let interfaceId = 0
	for (const signature of signatures) {
		if (typeof signature !== 'string' || !/^[A-Za-z_$][\w$]*\([^()\s]*\)$/.test(signature)) {
			throw new Error(`无效的函数签名：${String(signature)}`)
		}
		interfaceId = (interfaceId ^ Number.parseInt(functionSelector(signature, crypto), 16)) >>> 0
	}
	return `0x${interfaceId.toString(16).padStart(8, '0')}` as Hex
}

export const encodeCall = (
	signature: string,
	crypto: CryptoKind,
	args: Array<{ type: 'address' | 'uint256' | 'bytes4'; value: string }> = [],
): Hex => {
	const encoded = args
		.map(({type, value}) => {
			if (type === 'address') return word(value.replace(/^0x/, '').toLowerCase())
			if (type === 'bytes4') return value.replace(/^0x/, '').padEnd(64, '0')
			return word(BigInt(value).toString(16))
		})
		.join('')
	return `0x${functionSelector(signature, crypto)}${encoded}`
}

const cleanOutput = (value: unknown): string => {
	if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
		throw new Error('合约返回了无效 ABI 数据')
	}
	return value.slice(2)
}

export const decodeUint = (value: unknown): bigint => {
	const hex = cleanOutput(value)
	if (hex.length !== 64) throw new Error('整数 ABI 返回长度无效')
	return BigInt(`0x${hex}`)
}

export const decodeBool = (value: unknown): boolean => {
	const decoded = decodeUint(value)
	if (decoded !== 0n && decoded !== 1n) throw new Error('布尔 ABI 返回值无效')
	return decoded === 1n
}

export const decodeString = (value: unknown): string => {
	const hex = cleanOutput(value)
	if (hex.length === 64) {
		const bytes = Uint8Array.from(hex.match(/../g)!.map((item) => Number.parseInt(item, 16)))
		return new TextDecoder().decode(bytes).replace(/\0+$/, '')
	}
	if (hex.length < 128) throw new Error('字符串 ABI 返回长度无效')
	const offset = Number(BigInt(`0x${hex.slice(0, 64)}`))
	if (offset !== 32) throw new Error('字符串 ABI 偏移无效')
	const length = Number(BigInt(`0x${hex.slice(64, 128)}`))
	if (!Number.isSafeInteger(length) || length > 4096 || 128 + length * 2 > hex.length) {
		throw new Error('字符串 ABI 数据不完整')
	}
	return new TextDecoder().decode(
		Uint8Array.from(hex.slice(128, 128 + length * 2).match(/../g)!.map((item) => Number.parseInt(item, 16))),
	)
}
